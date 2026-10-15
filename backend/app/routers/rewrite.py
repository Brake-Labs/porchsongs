import asyncio
import base64
import json
import logging
from collections.abc import AsyncIterator, Awaitable, Iterator
from contextlib import contextmanager
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
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.scoping import get_user_profile, get_user_song, reject_documents
from ..config import settings
from ..database import get_db
from ..models import User
from ..schemas import (
    ChatRequest,
    ChatResponse,
    DefaultPromptsResponse,
    FileExtractRequest,
    FileExtractResponse,
    ImageExtractRequest,
    ImageExtractResponse,
    ModelsResponse,
    ParseRequest,
    ParseResponse,
    TagSuggestion,
    TagSuggestRequest,
    TagSuggestResponse,
    TokenUsage,
    UrlScrapeRequest,
    UrlScrapeResponse,
)
from ..services import llm_service, scrape_service
from ..services.chat_turn import ChatTurn
from ..services.llm_service import ReasoningDelta, StreamAccumulator, StreamEvent, TextDelta
from ..services.tags import user_tags

router = APIRouter()
logger = logging.getLogger(__name__)


def require_gateway(current_user: User = Depends(get_current_user)) -> None:
    """Dependency: 503 when no LLM gateway is configured (``LLM_API_BASE`` unset).

    Depends on ``get_current_user`` so an unauthenticated request still gets its
    401 first. FastAPI caches the user per request, so this resolves it once.
    """
    if not settings.llm_api_base:
        raise HTTPException(
            status_code=503,
            detail={
                "detail": "No AI gateway is configured. Set LLM_API_BASE (and "
                "LLM_API_KEY) on the server to enable AI features.",
                "error_type": "gateway_not_configured",
            },
        )


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
        return {
            "detail": "The AI gateway rejected the request (authentication failed). "
            "Check the LLM_API_KEY configured on the server.",
            "error_type": "auth_error",
        }
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


@contextmanager
def llm_errors() -> Iterator[None]:
    """Turn an LLM call's failure into a 502 carrying the ``error_type`` contract.

    ``HTTPException`` passes through untouched (e.g. the 499 from ``_cancellable``).
    Every LLM route, here and in ``follow.py``, goes through this or ``_sse_error``,
    and both resolve ``_format_llm_error`` from this module at call time, which is
    what premium's tests patch.
    """
    try:
        yield
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502, detail=_format_llm_error(e, settings.llm_provider)
        ) from None


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _sse_error(e: Exception) -> str:
    return _sse("error", _format_llm_error(e, settings.llm_provider))


def _sse_delta(event: StreamEvent) -> str | None:
    """The SSE frame for a streamed delta. Usage is not forwarded until ``done``."""
    if isinstance(event, TextDelta):
        return _sse("token", event.text)
    if isinstance(event, ReasoningDelta):
        return _sse("reasoning", event.text)
    return None


_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


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


@router.get("/prompts/defaults", response_model=DefaultPromptsResponse, tags=["prompts"])
async def get_default_prompts(
    current_user: User = Depends(get_current_user),
) -> DefaultPromptsResponse:
    return DefaultPromptsResponse(
        parse=llm_service.CLEAN_SYSTEM_PROMPT,
        chat=llm_service.CHAT_SYSTEM_PROMPT,
    )


@router.post("/parse", response_model=ParseResponse, dependencies=[Depends(require_gateway)])
async def parse(
    req: ParseRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ParseResponse:
    profile = await run_in_threadpool(get_user_profile, db, current_user, req.profile_id)
    system_prompt = profile.system_prompt_parse

    with llm_errors():
        result = await _cancellable(
            request,
            llm_service.parse_content(
                content=req.content,
                provider=settings.llm_provider,
                model=req.model,
                api_base=settings.llm_api_base,
                reasoning_effort=req.reasoning_effort,
                instruction=req.instruction,
                system_prompt=system_prompt,
                max_tokens=req.max_tokens,
                api_key=settings.llm_api_key,
            ),
        )

    usage_data = result.get("usage")
    usage = TokenUsage(**usage_data) if usage_data else None

    return ParseResponse(
        original_content=result["original_content"],
        title=result.get("title"),
        artist=result.get("artist"),
        reasoning=result.get("reasoning"),
        usage=usage,
    )


@router.post("/parse/stream", dependencies=[Depends(require_gateway)])
async def parse_stream(
    req: ParseRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    profile = await run_in_threadpool(get_user_profile, db, current_user, req.profile_id)

    # Extract ORM value before the generator runs: the DB session may be
    # closed by then, making ORM attribute access raise DetachedInstanceError.
    system_prompt = profile.system_prompt_parse

    async def event_generator() -> AsyncIterator[str]:
        reply = StreamAccumulator()
        try:
            stream = llm_service.parse_content_stream(
                content=req.content,
                provider=settings.llm_provider,
                model=req.model,
                api_base=settings.llm_api_base,
                reasoning_effort=req.reasoning_effort,
                instruction=req.instruction,
                system_prompt=system_prompt,
                max_tokens=req.max_tokens,
                api_key=settings.llm_api_key,
            )
            async for event in stream:
                if await request.is_disconnected():
                    return
                reply.consume(event)
                frame = _sse_delta(event)
                if frame is not None:
                    yield frame
        except Exception as e:
            logger.exception("Parse stream LLM error")
            yield _sse_error(e)
            return

        parsed = llm_service.parse_clean_response(reply.text, req.content)
        done_data: dict[str, object] = {
            "original_content": parsed["original"],
            "title": parsed["title"],
            "artist": parsed["artist"],
            "reasoning": reply.reasoning or None,
            "usage": reply.usage,
        }
        yield _sse("done", done_data)

    return StreamingResponse(
        event_generator(), media_type="text/event-stream", headers=_SSE_HEADERS
    )


@router.post(
    "/parse/image", response_model=ImageExtractResponse, dependencies=[Depends(require_gateway)]
)
async def parse_image(
    req: ImageExtractRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ImageExtractResponse:
    """Extract song text from an uploaded image using LLM vision."""
    await run_in_threadpool(get_user_profile, db, current_user, req.profile_id)

    with llm_errors():
        result = await _cancellable(
            request,
            llm_service.extract_text_from_image(
                image_data_url=req.image,
                provider=settings.llm_provider,
                model=req.model,
                api_base=settings.llm_api_base,
                max_tokens=req.max_tokens,
                api_key=settings.llm_api_key,
            ),
        )

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
def parse_file(
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
        return _extract_pdf(file_bytes)
    elif filename_lower.endswith((".txt", ".text")):
        return _extract_text(file_bytes)
    else:
        raise HTTPException(
            status_code=422,
            detail="Unsupported file type. Supported formats: PDF, TXT.",
        )


@router.post("/parse/url", response_model=UrlScrapeResponse)
def parse_url(
    req: UrlScrapeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UrlScrapeResponse:
    """Fetch a web page the user linked to and extract song text from it.

    Returns the extracted text (with any detected title/artist prepended) so it
    can flow through the normal parse pipeline, plus the source URL for record.
    """
    get_user_profile(db, current_user, req.profile_id)

    try:
        result = scrape_service.scrape_url(req.url)
    except scrape_service.ScrapeError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from None
    except Exception:
        logger.exception("URL scrape failed for %s", req.url)
        raise HTTPException(
            status_code=502, detail="Something went wrong fetching that link. Please try again."
        ) from None

    return UrlScrapeResponse(
        text=result.text,
        title=result.title,
        artist=result.artist,
        source_url=req.url,
    )


@router.post("/chat", response_model=ChatResponse, dependencies=[Depends(require_gateway)])
async def chat(
    req: ChatRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    turn = await run_in_threadpool(ChatTurn.prepare, db, current_user, req)

    with llm_errors():
        await _cancellable(request, turn.complete())

    version = await run_in_threadpool(turn.persist)
    if version is None:
        raise HTTPException(status_code=404, detail="Song not found")
    return ChatResponse.model_validate(turn.result(version))


@router.post("/chat/stream", dependencies=[Depends(require_gateway)])
async def chat_stream(
    req: ChatRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    turn = await run_in_threadpool(ChatTurn.prepare, db, current_user, req)

    async def event_generator() -> AsyncIterator[str]:
        stream = turn.stream()
        # Set once this generator no longer owns the stream: it ran to the end,
        # failed, or was handed to a background task.
        settled = False
        try:
            async for event in stream:
                # Record the event before anything else: async for has already
                # taken it off the iterator, so a hand-off must not drop it.
                turn.consume(event)
                if await request.is_disconnected():
                    # Client gone (e.g. mobile tab suspended). Finish the LLM
                    # call in the background so the reply is saved for them.
                    turn.hand_off(stream)
                    settled = True
                    return
                frame = _sse_delta(event)
                if frame is not None:
                    yield frame
            settled = True
        except Exception as e:
            settled = True
            logger.exception("Chat stream LLM error")
            yield _sse_error(e)
            return
        finally:
            if not settled:
                # Generator abandoned by Starlette (client disconnected between
                # yields, so the is_disconnected() check never ran). This covers
                # the pre-first-token window too: the LLM call was initiated, so
                # let it complete even if nothing has arrived yet.
                logger.info(
                    "Chat stream generator abandoned with %d chars accumulated, "
                    "spawning background task for song %s",
                    len(turn.reply.text),
                    turn.song_id,
                )
                turn.hand_off(stream)

        # Fresh session in the threadpool: the request session may be closed by
        # now, and a commit on the loop would stall other streams. A failed
        # commit reports no version rather than a stale one.
        version: int | None = None
        try:
            version = await run_in_threadpool(turn.persist)
            if version is None:
                logger.warning("Chat stream persist: song %s not found", turn.song_id)
        except Exception:
            logger.exception("Chat stream DB persist error")

        yield _sse("done", turn.result(version))

    return StreamingResponse(
        event_generator(), media_type="text/event-stream", headers=_SSE_HEADERS
    )


@router.post(
    "/tags/suggest",
    response_model=TagSuggestResponse,
    tags=["songs"],
    dependencies=[Depends(require_gateway)],
)
async def suggest_tags(
    req: TagSuggestRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TagSuggestResponse:
    """Suggest tags for one chart, ranking the user's own tags first.

    Opt-in and per chart. Importing a chart stays free and makes no LLM call at
    all, so this is the only place organising can cost anything, and it costs it
    only when someone asks for it.

    Several suggestions per call rather than one, because a song carries several
    tags: one paid call now does the work that used to take one per tag.

    Nothing is written here. The response is a proposal; the client writes the
    tags through the ordinary ``PUT /api/songs/{ref}`` when the user taps them.

    Lives beside the other LLM endpoints rather than in ``songs.py`` because
    that is what makes it metered: the premium guard intercepts LLM traffic by
    path, and an organising endpoint hidden among the CRUD routes would be an
    unmetered way onto the operator's gateway.
    """

    def _load() -> tuple[str | None, str | None, str, dict[str, int]]:
        song = get_user_song(db, current_user, req.song_id)
        reject_documents(song, "sent to the model")
        content = song.rewritten_content or song.original_content
        return song.title, song.artist, content, dict(user_tags(db, current_user.id))

    title, artist, content, counts = await run_in_threadpool(_load)
    existing_tags = sorted(counts)

    with llm_errors():
        result = await _cancellable(
            request,
            llm_service.suggest_tags(
                title=title,
                artist=artist,
                content=content,
                existing_tags=existing_tags,
                provider=settings.llm_provider,
                model=req.model,
                api_base=settings.llm_api_base,
                api_key=settings.llm_api_key,
                max_tokens=req.max_tokens,
            ),
        )

    # The service says whether a tag is new; the count is this router's to add,
    # since it is the one holding the numbers. A tag the service marked new has
    # no count by definition.
    suggestions = [
        TagSuggestion(tag=s["tag"], count=0 if s["is_new"] else counts.get(s["tag"], 0))
        for s in result["suggestions"]
    ]

    # A reply we could not read still has to leave the user with something to
    # tap, so fall back to the artist. Costs nothing extra: the call is already
    # paid for by the time we get here.
    if not suggestions:
        fallback = (artist or "").strip()[: llm_service.TAG_NAME_MAX_CHARS]
        if fallback and fallback.casefold() not in {f.casefold() for f in existing_tags}:
            suggestions = [TagSuggestion(tag=fallback, count=0)]

    usage_data = result.get("usage")
    return TagSuggestResponse(
        suggestions=suggestions,
        usage=TokenUsage(**usage_data) if usage_data else None,
    )


@router.get(
    "/models",
    response_model=ModelsResponse,
    tags=["providers"],
    dependencies=[Depends(require_gateway)],
)
async def list_models(
    current_user: User = Depends(get_current_user),
) -> ModelsResponse:
    """List the models the configured gateway exposes for the current API key."""
    with llm_errors():
        models = await llm_service.get_models(
            settings.llm_provider,
            api_base=settings.llm_api_base,
            api_key=settings.llm_api_key,
        )
    return ModelsResponse(models=models)
