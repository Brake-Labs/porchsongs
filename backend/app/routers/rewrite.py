import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import TypeVar

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.scoping import get_user_profile, get_user_song
from ..database import get_db
from ..models import ChatMessage as ChatMessageModel
from ..models import Profile, ProfileModel, ProviderConnection, Song, SongRevision, User
from ..schemas import (
    AbcRequest,
    AbcResponse,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    DefaultPromptsResponse,
    ParseRequest,
    ParseResponse,
    ProvidersResponse,
    TokenUsage,
)
from ..services import llm_service

router = APIRouter()
logger = logging.getLogger(__name__)

# Maps provider names to the env var they need for authentication.
_PROVIDER_KEY_ENV_VARS: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "google": "GOOGLE_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    "cohere": "COHERE_API_KEY",
    "groq": "GROQ_API_KEY",
    "together": "TOGETHER_API_KEY",
    "fireworks": "FIREWORKS_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


def _format_llm_error(e: Exception, provider: str | None = None) -> str:
    """Turn raw SDK errors into user-friendly messages with setup instructions.

    Auth-related errors get a specific hint (these are operator-facing anyway).
    All other errors return a generic message — the full details are logged
    server-side so they don't leak to the frontend.
    """
    msg = str(e).lower()
    if "api key" in msg or "apikey" in msg or "authentication" in msg or "unauthorized" in msg:
        env_var = _PROVIDER_KEY_ENV_VARS.get(provider or "")
        if env_var:
            return (
                f"No API key configured for {provider}. "
                f"Set the {env_var} environment variable on the server and restart. "
                f"Example: export {env_var}=sk-..."
            )
        return (
            f"No API key configured for {provider or 'this provider'}. "
            "Set the appropriate API key environment variable on the server and restart."
        )
    logger.exception("LLM call failed (provider=%s)", provider)
    return "Something went wrong while processing your request. Please try again."


T = TypeVar("T")


async def _cancellable(request: Request, coro: asyncio.Future[T]) -> T:
    """Run *coro* but cancel it if the client disconnects."""
    task = asyncio.ensure_future(coro)

    async def _watch_disconnect() -> None:
        while not task.done():
            if await request.is_disconnected():
                task.cancel()
                return
            await asyncio.sleep(0.5)

    watcher = asyncio.ensure_future(_watch_disconnect())
    try:
        return await task
    except asyncio.CancelledError:
        raise HTTPException(status_code=499, detail="Client disconnected") from None
    finally:
        watcher.cancel()


def _lookup_api_base(
    db: Session, profile_id: int | None, provider: str | None, model: str | None
) -> str | None:
    """Look up api_base: prefer ProviderConnection, fall back to ProfileModel."""
    if not profile_id or not provider:
        return None
    conn = (
        db.query(ProviderConnection)
        .filter(
            ProviderConnection.profile_id == profile_id,
            ProviderConnection.provider == provider,
        )
        .first()
    )
    if conn and conn.api_base:
        return conn.api_base
    # Backward compat: check ProfileModel
    if model:
        pm = (
            db.query(ProfileModel)
            .filter(
                ProfileModel.profile_id == profile_id,
                ProfileModel.provider == provider,
                ProfileModel.model == model,
            )
            .first()
        )
        if pm and pm.api_base:
            return pm.api_base
    return None


@router.get("/prompts/defaults", response_model=DefaultPromptsResponse, tags=["prompts"])
async def get_default_prompts(
    current_user: User = Depends(get_current_user),
) -> DefaultPromptsResponse:
    return DefaultPromptsResponse(
        parse=llm_service.CLEAN_SYSTEM_PROMPT,
        chat=llm_service.CHAT_SYSTEM_PROMPT,
    )


@router.post("/parse", response_model=ParseResponse)
async def parse(
    req: ParseRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ParseResponse:
    profile = get_user_profile(db, current_user, req.profile_id)
    api_base = _lookup_api_base(db, req.profile_id, req.provider, req.model)

    try:
        result = await _cancellable(
            request,
            llm_service.parse_content(
                content=req.content,
                provider=req.provider,
                model=req.model,
                api_base=api_base,
                reasoning_effort=req.reasoning_effort,
                instruction=req.instruction,
                system_prompt=profile.system_prompt_parse,
                max_tokens=req.max_tokens,
                api_key=req.api_key,
            ),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=_format_llm_error(e, req.provider)) from None

    usage_data = result.get("usage")
    usage = TokenUsage(**usage_data) if usage_data else None

    return ParseResponse(
        original_content=result["original_content"],
        title=result.get("title"),
        artist=result.get("artist"),
        reasoning=result.get("reasoning"),
        usage=usage,
    )


@router.post("/parse/stream")
async def parse_stream(
    req: ParseRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    profile = get_user_profile(db, current_user, req.profile_id)
    api_base = _lookup_api_base(db, req.profile_id, req.provider, req.model)

    async def event_generator() -> AsyncIterator[str]:
        accumulated = ""
        reasoning_accumulated = ""
        usage_data: dict[str, int] | None = None
        try:
            stream = llm_service.parse_content_stream(
                content=req.content,
                provider=req.provider,
                model=req.model,
                api_base=api_base,
                reasoning_effort=req.reasoning_effort,
                instruction=req.instruction,
                system_prompt=profile.system_prompt_parse,
                max_tokens=req.max_tokens,
                api_key=req.api_key,
            )
            async for kind, text in stream:
                if await request.is_disconnected():
                    return
                if kind == "reasoning":
                    reasoning_accumulated += text
                    yield f"event: reasoning\ndata: {json.dumps(text)}\n\n"
                elif kind == "usage":
                    usage_data = json.loads(text)
                else:
                    accumulated += text
                    yield f"event: token\ndata: {json.dumps(text)}\n\n"
        except Exception as e:
            logger.exception("Parse stream LLM error")
            detail = _format_llm_error(e, req.provider)
            yield f"event: error\ndata: {json.dumps({'detail': detail})}\n\n"
            return

        # Parse the accumulated response
        parsed = llm_service._parse_clean_response(accumulated, req.content)
        done_data: dict[str, object] = {
            "original_content": parsed["original"],
            "title": parsed["title"],
            "artist": parsed["artist"],
            "reasoning": reasoning_accumulated or None,
            "usage": usage_data,
        }
        yield f"event: done\ndata: {json.dumps(done_data)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
) -> list[dict[str, object]]:
    """Load persisted chat history and append new request messages."""
    history_rows = (
        db.query(ChatMessageModel)
        .filter(ChatMessageModel.song_id == song_id, ChatMessageModel.is_note.is_(False))
        .order_by(ChatMessageModel.created_at)
        .all()
    )
    history: list[dict[str, object]] = [
        {"role": row.role, "content": _deserialize_content(row.content)} for row in history_rows
    ]
    return history + [{"role": m.role, "content": m.content} for m in req_messages]


def _persist_chat_result(
    db: Session,
    song: Song,
    rewritten_content: str | None,
    changes_summary: str,
    assistant_content: str,
    req_messages: list[ChatMessage],
    original_content: str | None = None,
    reasoning: str | None = None,
    model: str | None = None,
) -> None:
    """Update song, create revision, and save chat messages (does not commit)."""
    if original_content is not None:
        song.original_content = original_content

    if rewritten_content is not None:
        song.rewritten_content = rewritten_content
        song.changes_summary = changes_summary
        song.current_version += 1

        db.add(
            SongRevision(
                song_id=song.id,
                version=song.current_version,
                rewritten_content=rewritten_content,
                changes_summary=changes_summary,
                edit_type="chat",
            )
        )

    last_user_msg = req_messages[-1] if req_messages else None
    if last_user_msg and last_user_msg.role == "user":
        content = last_user_msg.content
        db.add(
            ChatMessageModel(
                song_id=song.id,
                role="user",
                content=json.dumps(content) if isinstance(content, list) else content,
                is_note=False,
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
        )
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    song = get_user_song(db, current_user, req.song_id)
    messages = _load_chat_messages(db, song.id, req.messages)
    api_base = _lookup_api_base(db, song.profile_id, req.provider, req.model)
    profile = db.query(Profile).filter(Profile.id == song.profile_id).first()

    try:
        result = await _cancellable(
            request,
            llm_service.chat_edit_content(
                song=song,
                messages=messages,
                provider=req.provider,
                model=req.model,
                api_base=api_base,
                reasoning_effort=req.reasoning_effort,
                system_prompt=profile.system_prompt_chat if profile else None,
                max_tokens=req.max_tokens,
                api_key=req.api_key,
            ),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=_format_llm_error(e, req.provider)) from None

    _persist_chat_result(
        db,
        song,
        rewritten_content=result["rewritten_content"],
        changes_summary=result["changes_summary"],
        assistant_content=result["assistant_message"],
        req_messages=req.messages,
        original_content=result.get("original_content"),
        reasoning=result.get("reasoning"),
        model=req.model,
    )
    db.commit()

    usage_data = result.get("usage")
    usage = TokenUsage(**usage_data) if usage_data else None

    return ChatResponse(
        rewritten_content=result["rewritten_content"],
        original_content=result.get("original_content"),
        assistant_message=result["assistant_message"],
        changes_summary=result["changes_summary"],
        version=song.current_version,
        reasoning=result.get("reasoning"),
        usage=usage,
    )


@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    song = get_user_song(db, current_user, req.song_id)
    messages = _load_chat_messages(db, song.id, req.messages)
    api_base = _lookup_api_base(db, song.profile_id, req.provider, req.model)
    profile = db.query(Profile).filter(Profile.id == song.profile_id).first()

    async def event_generator() -> AsyncIterator[str]:
        accumulated = ""
        reasoning_accumulated = ""
        usage_data: dict[str, int] | None = None
        try:
            stream = llm_service.chat_edit_content_stream(
                song=song,
                messages=messages,
                provider=req.provider,
                model=req.model,
                api_base=api_base,
                reasoning_effort=req.reasoning_effort,
                system_prompt=profile.system_prompt_chat if profile else None,
                max_tokens=req.max_tokens,
                api_key=req.api_key,
            )
            async for kind, text in stream:
                if await request.is_disconnected():
                    return
                if kind == "reasoning":
                    reasoning_accumulated += text
                    yield f"event: reasoning\ndata: {json.dumps(text)}\n\n"
                elif kind == "usage":
                    usage_data = json.loads(text)
                else:
                    accumulated += text
                    yield f"event: token\ndata: {json.dumps(text)}\n\n"
        except Exception as e:
            logger.exception("Chat stream LLM error")
            detail = _format_llm_error(e, req.provider)
            yield f"event: error\ndata: {json.dumps({'detail': detail})}\n\n"
            return

        # Parse the accumulated response
        parsed = llm_service._parse_chat_response(accumulated)
        changes_summary = parsed["explanation"] or "Chat edit applied."

        # Persist to DB (wrapped so a DB error doesn't lose the result)
        try:
            _persist_chat_result(
                db,
                song,
                rewritten_content=parsed["content"],
                changes_summary=changes_summary,
                assistant_content=accumulated,
                req_messages=req.messages,
                original_content=parsed.get("original_content"),
                reasoning=reasoning_accumulated or None,
                model=req.model,
            )
            db.commit()
        except Exception:
            logger.exception("Chat stream DB persist error")
            db.rollback()

        # Send final result
        done_data: dict[str, object] = {
            "rewritten_content": parsed["content"],
            "original_content": parsed.get("original_content"),
            "assistant_message": accumulated,
            "changes_summary": changes_summary,
            "version": song.current_version,
            "reasoning": reasoning_accumulated or None,
            "usage": usage_data,
        }
        yield f"event: done\ndata: {json.dumps(done_data)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --- ABC Notation ---


@router.post("/abc", response_model=AbcResponse)
async def generate_abc(
    req: AbcRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AbcResponse:
    get_user_profile(db, current_user, req.profile_id)
    api_base = _lookup_api_base(db, req.profile_id, req.provider, req.model)

    try:
        result = await _cancellable(
            request,
            llm_service.generate_abc(
                content=req.content,
                provider=req.provider,
                model=req.model,
                title=req.title,
                artist=req.artist,
                api_base=api_base,
                reasoning_effort=req.reasoning_effort,
                max_tokens=req.max_tokens,
                api_key=req.api_key,
            ),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=_format_llm_error(e, req.provider)) from None

    usage_data = result.get("usage")
    usage = TokenUsage(**usage_data) if usage_data else None

    return AbcResponse(
        abc=result.get("abc"),
        tips=result.get("tips"),
        explanation=result.get("explanation"),
        reasoning=result.get("reasoning"),
        usage=usage,
    )


@router.post("/abc/stream")
async def abc_stream(
    req: AbcRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    get_user_profile(db, current_user, req.profile_id)
    api_base = _lookup_api_base(db, req.profile_id, req.provider, req.model)

    async def event_generator() -> AsyncIterator[str]:
        accumulated = ""
        reasoning_accumulated = ""
        usage_data: dict[str, int] | None = None
        try:
            stream = llm_service.generate_abc_stream(
                content=req.content,
                provider=req.provider,
                model=req.model,
                title=req.title,
                artist=req.artist,
                api_base=api_base,
                reasoning_effort=req.reasoning_effort,
                max_tokens=req.max_tokens,
                api_key=req.api_key,
            )
            async for kind, text in stream:
                if await request.is_disconnected():
                    return
                if kind == "reasoning":
                    reasoning_accumulated += text
                    yield f"event: reasoning\ndata: {json.dumps(text)}\n\n"
                elif kind == "usage":
                    usage_data = json.loads(text)
                else:
                    accumulated += text
                    yield f"event: token\ndata: {json.dumps(text)}\n\n"
        except Exception as e:
            logger.exception("ABC stream LLM error")
            detail = _format_llm_error(e, req.provider)
            yield f"event: error\ndata: {json.dumps({'detail': detail})}\n\n"
            return

        parsed = llm_service._parse_abc_response(accumulated)
        done_data: dict[str, object] = {
            "abc": parsed["abc"],
            "tips": parsed["tips"],
            "explanation": parsed["explanation"],
            "reasoning": reasoning_accumulated or None,
            "usage": usage_data,
        }
        yield f"event: done\ndata: {json.dumps(done_data)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/providers", response_model=ProvidersResponse, tags=["providers"])
async def list_providers(
    current_user: User = Depends(get_current_user),
) -> ProvidersResponse:
    return ProvidersResponse(
        providers=llm_service.get_configured_providers(),
        platform_enabled=llm_service.is_platform_enabled(),
    )


@router.get("/providers/{provider}/models")
async def list_provider_models(
    provider: str,
    api_base: str | None = None,
    current_user: User = Depends(get_current_user),
) -> list[str]:
    try:
        return await llm_service.get_models(provider, api_base=api_base)
    except Exception as e:
        raise HTTPException(status_code=502, detail=_format_llm_error(e, provider)) from None
