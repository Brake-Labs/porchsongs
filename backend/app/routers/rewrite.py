import asyncio
import base64
import json
import logging
from collections.abc import AsyncIterator, Awaitable
from io import BytesIO
from typing import TypeVar

from any_llm import (
    AnyLLMError,
    ContentFilterError,
    ContextLengthExceededError,
    MissingApiKeyError,
    ModelNotFoundError,
    ProviderError,
    RateLimitError,
)
from any_llm import AuthenticationError as LLMAuthError
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.scoping import get_user_profile, get_user_song
from ..database import SessionLocal, get_db
from ..models import ChatMessage as ChatMessageModel
from ..models import Profile, ProfileModel, ProviderConnection, Song, SongRevision, User
from ..schemas import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    DefaultPromptsResponse,
    FileExtractRequest,
    FileExtractResponse,
    ImageExtractRequest,
    ImageExtractResponse,
    ParseRequest,
    ParseResponse,
    ProvidersResponse,
    TokenUsage,
)
from ..services import llm_service

router = APIRouter()
logger = logging.getLogger(__name__)

# Strong references to background tasks so they aren't GC'd before completion.
_background_tasks: set[asyncio.Task[None]] = set()

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


def _format_llm_error(e: Exception, provider: str | None = None) -> dict[str, str]:
    """Turn raw SDK errors into user-friendly messages with error classification.

    Returns ``{"detail": "...", "error_type": "..."}`` so the frontend can
    distinguish provider issues from internal errors.
    """
    if isinstance(e, RateLimitError):
        return {
            "detail": "The AI provider is currently rate-limited. "
            "Please wait a moment and try again.",
            "error_type": "provider_rate_limit",
        }
    if isinstance(e, ProviderError):
        return {
            "detail": "The AI provider is experiencing issues. "
            "This is not a PorchSongs problem. Please try again shortly.",
            "error_type": "provider_error",
        }
    if isinstance(e, ContentFilterError):
        return {
            "detail": "The AI provider blocked this request due to content filtering.",
            "error_type": "content_filter",
        }
    if isinstance(e, ContextLengthExceededError):
        return {
            "detail": "The input is too long for this model. "
            "Try shortening your text or choosing a model "
            "with a larger context window.",
            "error_type": "context_length",
        }
    if isinstance(e, (LLMAuthError, MissingApiKeyError)):
        env_var = _PROVIDER_KEY_ENV_VARS.get(provider or "")
        if env_var:
            detail = (
                f"No API key configured for {provider}. "
                f"Set the {env_var} environment variable on the server "
                f"and restart. Example: export {env_var}=sk-..."
            )
        else:
            detail = (
                f"No API key configured for {provider or 'this provider'}. "
                "Set the appropriate API key environment variable "
                "on the server and restart."
            )
        return {"detail": detail, "error_type": "auth_error"}
    if isinstance(e, ModelNotFoundError):
        return {
            "detail": "The selected model is not available. Please choose a different model.",
            "error_type": "model_not_found",
        }
    if isinstance(e, AnyLLMError):
        logger.exception("LLM call failed (provider=%s)", provider)
        return {
            "detail": "The AI provider returned an unexpected error. Please try again.",
            "error_type": "provider_unknown",
        }
    logger.exception("LLM call failed (provider=%s)", provider)
    return {
        "detail": "Something went wrong while processing your request. Please try again.",
        "error_type": "internal_error",
    }


T = TypeVar("T")


async def _cancellable(request: Request, coro: Awaitable[T]) -> T:
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

    # Extract ORM value before the generator runs — the DB session may be
    # closed by then, making ORM attribute access raise DetachedInstanceError.
    system_prompt = profile.system_prompt_parse

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
                system_prompt=system_prompt,
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
            yield f"event: error\ndata: {json.dumps(_format_llm_error(e, req.provider))}\n\n"
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


@router.post("/parse/image", response_model=ImageExtractResponse)
async def parse_image(
    req: ImageExtractRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ImageExtractResponse:
    """Extract song text from an uploaded image using LLM vision."""
    get_user_profile(db, current_user, req.profile_id)
    api_base = _lookup_api_base(db, req.profile_id, req.provider, req.model)

    try:
        result = await _cancellable(
            request,
            llm_service.extract_text_from_image(
                image_data_url=req.image,
                provider=req.provider,
                model=req.model,
                api_base=api_base,
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

    return ImageExtractResponse(text=result["text"], usage=usage)


def _extract_pdf(file_bytes: bytes) -> FileExtractResponse:
    """Extract text from a PDF using pypdf."""
    from pypdf import PdfReader
    from pypdf.errors import FileNotDecryptedError, PdfReadError

    try:
        reader = PdfReader(BytesIO(file_bytes))
    except FileNotDecryptedError:
        raise HTTPException(
            status_code=422,
            detail="This PDF is password-protected. Please unlock it first.",
        ) from None
    except PdfReadError:
        raise HTTPException(
            status_code=422, detail="Could not read this PDF. The file may be corrupted."
        ) from None

    max_pages = 10
    pages = reader.pages[:max_pages]
    text_parts: list[str] = []
    for page in pages:
        try:
            text_parts.append(page.extract_text() or "")
        except Exception:
            text_parts.append("")  # skip corrupted pages

    text = "\n".join(text_parts).strip()

    if len(text) < 10:
        raise HTTPException(
            status_code=422,
            detail="This PDF appears to contain scanned images rather than text. "
            "Try Import from Photo instead.",
        )

    if len(reader.pages) > max_pages:
        text += (
            f"\n\n[Note: Only the first {max_pages} of {len(reader.pages)} pages were extracted.]"
        )

    return FileExtractResponse(text=text)


def _extract_text(file_bytes: bytes) -> FileExtractResponse:
    """Extract text from a plain text file."""
    try:
        text = file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        # latin-1 can decode any byte sequence, so this is a safe fallback
        text = file_bytes.decode("latin-1")
    return FileExtractResponse(text=text.strip())


@router.post("/parse/file", response_model=FileExtractResponse)
async def parse_file(
    req: FileExtractRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileExtractResponse:
    """Extract text from an uploaded PDF or text file."""
    get_user_profile(db, current_user, req.profile_id)

    # Decode base64 file data
    try:
        # Strip data URL prefix if present (e.g. "data:application/pdf;base64,...")
        raw = req.file_data
        if "," in raw and raw.index(",") < 200:
            raw = raw.split(",", 1)[1]
        file_bytes = base64.b64decode(raw)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid base64 file data.") from None

    # File size check (10 MB)
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=422, detail="File too large. Maximum size is 10 MB.")

    filename_lower = req.filename.lower()

    if filename_lower.endswith(".pdf"):
        return await asyncio.to_thread(_extract_pdf, file_bytes)
    elif filename_lower.endswith((".txt", ".text")):
        return _extract_text(file_bytes)
    else:
        raise HTTPException(
            status_code=422,
            detail="Unsupported file type. Supported formats: PDF, TXT.",
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


def _persist_chat_result(
    db: Session,
    song: Song,
    rewritten_content: str | None,
    changes_summary: str,
    assistant_content: str,
    original_content: str | None = None,
    reasoning: str | None = None,
    model: str | None = None,
) -> None:
    """Update song, create revision, and save assistant message (does not commit).

    The user message is persisted earlier via ``_persist_user_message`` so that
    it survives request cancellation.
    """
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


async def _finish_chat_in_background(
    stream: AsyncIterator[tuple[str, str]],
    accumulated: str,
    reasoning_accumulated: str,
    song_id: int,
    model: str | None,
) -> None:
    """Continue consuming an LLM stream and persist the result after client disconnect.

    Uses its own DB session since the request session may be closed.
    """
    try:
        async with asyncio.timeout(120):  # 2 min guard against hung streams
            async for kind, text in stream:
                if kind == "reasoning":
                    reasoning_accumulated += text
                elif kind == "usage":
                    pass  # usage stats not needed for persistence
                else:
                    accumulated += text
    except TimeoutError:
        logger.warning("Background chat stream timed out after 120s, persisting partial result")
    except Exception:
        logger.exception("Background chat stream completion error (LLM)")
        return

    parsed = llm_service._parse_chat_response(accumulated)
    changes_summary = parsed["explanation"] or "Chat edit applied."

    db = SessionLocal()
    try:
        song = db.query(Song).filter(Song.id == song_id).first()
        if not song:
            logger.warning("Background chat persist: song %s not found", song_id)
            return
        _persist_chat_result(
            db,
            song,
            rewritten_content=parsed["content"],
            changes_summary=changes_summary,
            assistant_content=accumulated,
            original_content=parsed.get("original_content"),
            reasoning=reasoning_accumulated or None,
            model=model,
        )
        db.commit()
        logger.info("Background chat persist succeeded for song %s", song_id)
    except Exception:
        logger.exception("Background chat stream DB persist error")
        db.rollback()
    finally:
        db.close()


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    song = get_user_song(db, current_user, req.song_id)
    messages, history_len = _load_chat_messages(db, song.id, req.messages)
    api_base = _lookup_api_base(db, song.profile_id, req.provider, req.model)
    profile = db.query(Profile).filter(Profile.id == song.profile_id).first()

    # Extract ORM values before commit (commit expires cached attributes).
    system_prompt = profile.system_prompt_chat if profile else None
    original_content = song.original_content
    # Use frontend-provided rewritten_content (avoids autosave race), else DB value.
    # Explicit None check so an empty string from the client doesn't silently
    # fall through to the DB value.
    rewritten_content = (
        req.rewritten_content if req.rewritten_content is not None else song.rewritten_content
    )

    # Persist the user message before the LLM call so it survives cancellation
    _persist_user_message(db, song.id, req.messages)
    db.commit()

    try:
        result = await _cancellable(
            request,
            llm_service.chat_edit_content(
                original_content=original_content,
                messages=messages,
                provider=req.provider,
                model=req.model,
                api_base=api_base,
                reasoning_effort=req.reasoning_effort,
                system_prompt=system_prompt,
                max_tokens=req.max_tokens,
                api_key=req.api_key,
                history_len=history_len,
                rewritten_content=rewritten_content,
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
    messages, history_len = _load_chat_messages(db, song.id, req.messages)
    api_base = _lookup_api_base(db, song.profile_id, req.provider, req.model)
    profile = db.query(Profile).filter(Profile.id == song.profile_id).first()

    # Extract ORM values before commit.  commit() expires all cached attributes
    # and the DB session may close before the SSE generator runs, making ORM
    # attribute access raise DetachedInstanceError.
    system_prompt = profile.system_prompt_chat if profile else None
    original_content = song.original_content
    # Use frontend-provided rewritten_content (avoids autosave race), else DB value.
    # Explicit None check so an empty string from the client doesn't silently
    # fall through to the DB value.
    rewritten_content = (
        req.rewritten_content if req.rewritten_content is not None else song.rewritten_content
    )
    song_id = song.id

    # Persist the user message before streaming so it survives cancellation
    _persist_user_message(db, song.id, req.messages)
    db.commit()

    async def event_generator() -> AsyncIterator[str]:
        accumulated = ""
        reasoning_accumulated = ""
        usage_data: dict[str, int] | None = None
        try:
            stream = llm_service.chat_edit_content_stream(
                original_content=original_content,
                messages=messages,
                provider=req.provider,
                model=req.model,
                api_base=api_base,
                reasoning_effort=req.reasoning_effort,
                system_prompt=system_prompt,
                max_tokens=req.max_tokens,
                api_key=req.api_key,
                history_len=history_len,
                rewritten_content=rewritten_content,
            )
            async for kind, text in stream:
                if await request.is_disconnected():
                    # Process the current token before handing off —
                    # async for already consumed it from the iterator.
                    if kind == "reasoning":
                        reasoning_accumulated += text
                    elif kind != "usage":
                        accumulated += text
                    # Client gone (e.g. mobile tab suspended).
                    # Finish the LLM call in a background task so the
                    # result is persisted and available when they return.
                    task = asyncio.create_task(
                        _finish_chat_in_background(
                            stream,
                            accumulated,
                            reasoning_accumulated,
                            song_id,
                            req.model,
                        )
                    )
                    _background_tasks.add(task)
                    task.add_done_callback(_background_tasks.discard)
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
            yield f"event: error\ndata: {json.dumps(_format_llm_error(e, req.provider))}\n\n"
            return

        # Parse the accumulated response
        parsed = llm_service._parse_chat_response(accumulated)
        changes_summary = parsed["explanation"] or "Chat edit applied."

        # Persist to DB using a fresh session.  The request session may be
        # closed by the time this generator runs (FastAPI dependency cleanup).
        persist_db = SessionLocal()
        version: int | None = None
        try:
            fresh_song = persist_db.query(Song).filter(Song.id == song_id).first()
            if fresh_song:
                version = fresh_song.current_version
                _persist_chat_result(
                    persist_db,
                    fresh_song,
                    rewritten_content=parsed["content"],
                    changes_summary=changes_summary,
                    assistant_content=accumulated,
                    original_content=parsed.get("original_content"),
                    reasoning=reasoning_accumulated or None,
                    model=req.model,
                )
                persist_db.commit()
                version = fresh_song.current_version
            else:
                logger.warning("Chat stream persist: song %s not found", song_id)
        except Exception:
            logger.exception("Chat stream DB persist error")
            persist_db.rollback()
        finally:
            persist_db.close()

        # Send final result
        done_data: dict[str, object] = {
            "rewritten_content": parsed["content"],
            "original_content": parsed.get("original_content"),
            "assistant_message": accumulated,
            "changes_summary": changes_summary,
            "version": version,
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
