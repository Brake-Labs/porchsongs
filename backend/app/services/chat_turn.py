"""One chat turn: load it, run it, collect the reply, persist it.

``ChatTurn`` is the single owner of a turn's state. The streaming route feeds it
events and maps them to SSE frames; the non-streaming route fills it in one call;
and when a client drops mid-stream, the background finisher keeps feeding the
same object and persists it the same way. Reply text, reasoning and usage are
never tracked anywhere else, so no path can persist a turn missing one of them.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from ..auth.scoping import get_user_song, reject_documents
from ..config import settings
from ..database import SessionLocal
from ..models import ChatMessage as ChatMessageModel
from ..models import Profile, Song, SongRevision, User
from ..schemas import ChatMessage, ChatRequest
from . import llm_service
from .llm_service import StreamAccumulator, StreamEvent

logger = logging.getLogger(__name__)

# How long an abandoned stream may keep running before its partial reply is saved.
BACKGROUND_TIMEOUT_SECONDS = 120

# Strong references to background tasks so they aren't GC'd before completion.
_background_tasks: set[asyncio.Task[None]] = set()


def _deserialize_content(raw: str) -> str | list[dict[str, object]]:
    """Deserialize a persisted content value back to its original form."""
    if raw.startswith("["):
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            pass
    return raw


def _load_chat_messages(
    db: Session,
    song_id: int,
    req_messages: list[ChatMessage],
) -> tuple[list[dict[str, object]], int]:
    """Load persisted chat history and append new request messages.

    Returns (all_messages, history_len) where history_len is the count of
    messages from the database (before the new request messages).
    """
    history_rows = (
        db.query(ChatMessageModel)
        .filter(ChatMessageModel.song_id == song_id, ChatMessageModel.is_note.is_(False))
        .order_by(ChatMessageModel.created_at)
        .all()
    )
    history: list[dict[str, object]] = [
        {"role": row.role, "content": _deserialize_content(row.content)} for row in history_rows
    ]
    history_len = len(history)
    return history + [{"role": m.role, "content": m.content} for m in req_messages], history_len


def _persist_user_message(
    db: Session,
    song_id: int,
    req_messages: list[ChatMessage],
) -> None:
    """Persist the user message from the request so it survives cancellation."""
    last_user_msg = req_messages[-1] if req_messages else None
    if last_user_msg and last_user_msg.role == "user":
        content = last_user_msg.content
        db.add(
            ChatMessageModel(
                song_id=song_id,
                role="user",
                content=json.dumps(content) if isinstance(content, list) else content,
                is_note=False,
            )
        )


def persist_chat_result(
    db: Session,
    song: Song,
    rewritten_content: str | None,
    changes_summary: str,
    assistant_content: str,
    original_content: str | None = None,
    reasoning: str | None = None,
    model: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> int:
    """Update song, create revision, and save assistant message (does not commit).

    Returns the song's version after this turn.

    The user message is persisted earlier, in ``ChatTurn.prepare``, so that it
    survives request cancellation.
    """
    if original_content is not None:
        song.original_content = original_content

    version = song.current_version
    if rewritten_content is not None:
        song.rewritten_content = rewritten_content
        song.changes_summary = changes_summary
        # Bump in the database, not in Python. A read-then-add lets two persists
        # for one song (the background finisher and the user's next request)
        # claim the same version. The UPDATE also holds the row lock until
        # commit, so the second writer waits and reads the first one's number.
        version = db.execute(
            update(Song)
            .where(Song.id == song.id)
            .values(current_version=Song.current_version + 1)
            .returning(Song.current_version)
            .execution_options(synchronize_session=False)
        ).scalar_one()
        set_committed_value(song, "current_version", version)

        db.add(
            SongRevision(
                song_id=song.id,
                version=version,
                rewritten_content=rewritten_content,
                changes_summary=changes_summary,
                edit_type="chat",
            )
        )

    db.add(
        ChatMessageModel(
            song_id=song.id,
            role="assistant",
            content=assistant_content,
            is_note=False,
            reasoning=reasoning,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
    )
    return version


@dataclass
class ChatTurn:
    """A chat turn's inputs (read before the LLM call) and its reply so far.

    Inputs are plain values, not ORM objects: the request session is committed
    (expiring them) and may be closed before a stream finishes.
    """

    song_id: int
    messages: list[dict[str, object]]
    history_len: int
    system_prompt: str | None
    original_content: str
    rewritten_content: str | None
    model: str
    reasoning_effort: str | None = None
    max_tokens: int | None = None
    reply: StreamAccumulator = field(default_factory=StreamAccumulator)

    @classmethod
    def prepare(cls, db: Session, current_user: User, req: ChatRequest) -> ChatTurn:
        """Load the song and history and persist the user message (sync; commits).

        The user message is committed before the LLM call so it survives
        cancellation.
        """
        song = get_user_song(db, current_user, req.song_id)
        reject_documents(song, "sent to the model")
        messages, history_len = _load_chat_messages(db, song.id, req.messages)
        profile = db.query(Profile).filter(Profile.id == song.profile_id).first()
        turn = cls(
            song_id=song.id,
            messages=messages,
            history_len=history_len,
            system_prompt=profile.system_prompt_chat if profile else None,
            original_content=song.original_content,
            # Use frontend-provided rewritten_content (avoids autosave race), else
            # DB value. Explicit None check so an empty string from the client
            # doesn't silently fall through to the DB value.
            rewritten_content=(
                req.rewritten_content
                if req.rewritten_content is not None
                else song.rewritten_content
            ),
            model=req.model,
            reasoning_effort=req.reasoning_effort,
            max_tokens=req.max_tokens,
        )
        _persist_user_message(db, song.id, req.messages)
        db.commit()
        return turn

    def stream(self) -> AsyncIterator[StreamEvent]:
        """Start the streaming LLM call. Feed each event back through ``consume``."""
        return llm_service.chat_edit_content_stream(
            original_content=self.original_content,
            messages=self.messages,
            provider=settings.llm_provider,
            model=self.model,
            api_base=settings.llm_api_base,
            reasoning_effort=self.reasoning_effort,
            system_prompt=self.system_prompt,
            max_tokens=self.max_tokens,
            api_key=settings.llm_api_key,
            history_len=self.history_len,
            rewritten_content=self.rewritten_content,
        )

    async def complete(self) -> None:
        """Run the LLM call without streaming and record the whole reply at once."""
        result = await llm_service.chat_edit_content(
            original_content=self.original_content,
            messages=self.messages,
            provider=settings.llm_provider,
            model=self.model,
            api_base=settings.llm_api_base,
            reasoning_effort=self.reasoning_effort,
            system_prompt=self.system_prompt,
            max_tokens=self.max_tokens,
            api_key=settings.llm_api_key,
            history_len=self.history_len,
            rewritten_content=self.rewritten_content,
        )
        self.reply.text = result["assistant_message"]
        self.reply.reasoning = result.get("reasoning") or ""
        self.reply.usage = result.get("usage")

    def consume(self, event: StreamEvent) -> None:
        self.reply.consume(event)

    @property
    def parsed(self) -> dict[str, str | None]:
        return llm_service.parse_chat_response(self.reply.text)

    @property
    def changes_summary(self) -> str:
        return self.parsed["explanation"] or "Chat edit applied."

    def persist(self) -> int | None:
        """Persist the reply in its own session and commit.

        Sync, for ``run_in_threadpool``. The request session may be closed by
        the time a stream finishes. Returns the committed version, or None if
        the song is gone. Raises (after rolling back) if the commit fails.
        """
        parsed = self.parsed
        usage = self.reply.usage
        db = SessionLocal()
        try:
            song = db.query(Song).filter(Song.id == self.song_id).first()
            if not song:
                return None
            version = persist_chat_result(
                db,
                song,
                rewritten_content=parsed["content"],
                changes_summary=self.changes_summary,
                assistant_content=self.reply.text,
                original_content=parsed.get("original_content"),
                reasoning=self.reply.reasoning or None,
                model=self.model,
                input_tokens=usage.get("input_tokens") if usage else None,
                output_tokens=usage.get("output_tokens") if usage else None,
            )
            db.commit()
            return version
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def result(self, version: int | None) -> dict[str, object]:
        """The turn as the client sees it: the stream's ``done`` payload."""
        parsed = self.parsed
        return {
            "rewritten_content": parsed["content"],
            "original_content": parsed.get("original_content"),
            "assistant_message": self.reply.text,
            "changes_summary": self.changes_summary,
            "version": version,
            "reasoning": self.reply.reasoning or None,
            "usage": self.reply.usage,
        }

    async def finish_in_background(self, stream: AsyncIterator[StreamEvent]) -> None:
        """Keep consuming *stream* after the client left, then persist the turn.

        On a hung stream the partial reply is saved after the timeout; on an LLM
        error nothing is saved.
        """
        try:
            async with asyncio.timeout(BACKGROUND_TIMEOUT_SECONDS):
                async for event in stream:
                    self.consume(event)
        except TimeoutError:
            logger.warning(
                "Background chat stream timed out after %ss, persisting partial result",
                BACKGROUND_TIMEOUT_SECONDS,
            )
        except Exception:
            logger.exception("Background chat stream completion error (LLM)")
            return

        try:
            version = await run_in_threadpool(self.persist)
        except Exception:
            logger.exception("Background chat stream DB persist error")
            return
        if version is None:
            logger.warning("Background chat persist: song %s not found", self.song_id)
        else:
            logger.info("Background chat persist succeeded for song %s", self.song_id)

    def hand_off(self, stream: AsyncIterator[StreamEvent]) -> asyncio.Task[None]:
        """Finish *stream* in a background task so the reply is saved for the user."""
        task = asyncio.create_task(self.finish_in_background(stream))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
        return task
