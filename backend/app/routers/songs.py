import io
import json
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session, undefer

from ..auth.dependencies import get_current_user
from ..auth.scoping import get_user_profile, get_user_song, get_user_song_by_uuid
from ..database import get_db
from ..models import (
    ChatMessage,
    Song,
    SongBlob,
    SongFile,
    SongRevision,
    User,
)
from ..schemas import (
    ChatMessageCreate,
    ChatMessageOut,
    FolderRename,
    OkResponse,
    SongCreate,
    SongOut,
    SongRevisionOut,
    SongStatusUpdate,
    SongUpdate,
)
from ..services.blob_store import hashes_for_songs, prune_orphan_blobs, put_blob
from ..services.pdf_service import generate_song_pdf

router = APIRouter(tags=["songs"])

# A tab PDF is a page of line art per page, so a real one is single-digit
# megabytes. The cap exists because psycopg2 materialises a bytea whole in memory
# on both write and read: a request for a 200MB row is a request for 200MB of
# process memory, on a container sized for serving text.
MAX_DOCUMENT_BYTES = 25 * 1024 * 1024

# Deliberately just PDF. Every other plausible format (images of a page, Guitar
# Pro files) either needs a different viewer or a different story about zoom, and
# accepting bytes we cannot render is how a library fills up with items that open
# to an error.
DOCUMENT_CONTENT_TYPE = "application/pdf"


def _document_page_count(data: bytes) -> int | None:
    """Page count for the library row, read once at upload.

    Returns None rather than raising: a PDF that pypdf will not enumerate can
    still be a PDF the browser renders, and refusing the upload over a missing
    number would be trading the file for the label on it.
    """
    try:
        from pypdf import PdfReader

        return len(PdfReader(io.BytesIO(data)).pages)
    except Exception:
        return None


def reject_documents(song: Song, action: str) -> None:
    """Guard the text-only routes.

    A document has no chart text to revise, summarise, or discuss, so these are
    404-shaped rather than 400-shaped situations: the resource genuinely is not
    there. 409 says the song exists and this is not a thing it does, which is the
    accurate answer and the one the frontend can show.
    """
    if song.kind == "document":
        raise HTTPException(status_code=409, detail=f"A stored document cannot be {action}.")


def _resolve_song(db: Session, user: User, song_ref: str) -> Song:
    """Resolve a song by UUID string or integer ID for backward compat."""
    try:
        song_id = int(song_ref)
        return get_user_song(db, user, song_id)
    except ValueError:
        return get_user_song_by_uuid(db, user, song_ref)


@router.get("/songs", response_model=list[SongOut])
async def list_songs(
    profile_id: int | None = None,
    search: str | None = None,
    folder: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Song]:
    query = db.query(Song).filter(Song.user_id == current_user.id)
    if profile_id is not None:
        query = query.filter(Song.profile_id == profile_id)
    if search:
        pattern = f"%{search}%"
        query = query.filter((Song.title.ilike(pattern)) | (Song.artist.ilike(pattern)))
    if folder is not None:
        if folder == "__unfiled__":
            query = query.filter(Song.folder.is_(None))
        else:
            query = query.filter(Song.folder == folder)
    return query.order_by(Song.created_at.desc()).all()


@router.get("/songs/folders", response_model=list[str])
async def list_folders(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[str]:
    rows = (
        db.query(Song.folder)
        .filter(Song.user_id == current_user.id, Song.folder.isnot(None), Song.folder != "")
        .distinct()
        .all()
    )
    return sorted(row[0] for row in rows)


@router.put("/songs/folders/{folder_name}", response_model=OkResponse)
async def rename_folder(
    folder_name: str,
    data: FolderRename,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OkResponse:
    db.query(Song).filter(Song.user_id == current_user.id, Song.folder == folder_name).update(
        {Song.folder: data.name}
    )
    db.commit()
    return OkResponse(ok=True)


@router.delete("/songs/folders/{folder_name}", response_model=OkResponse)
async def delete_folder(
    folder_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OkResponse:
    db.query(Song).filter(Song.user_id == current_user.id, Song.folder == folder_name).update(
        {Song.folder: None}
    )
    db.commit()
    return OkResponse(ok=True)


@router.post("/songs/documents", response_model=SongOut, status_code=201)
async def upload_document(
    profile_id: int = Form(...),
    title: str | None = Form(None),
    artist: str | None = Form(None),
    folder: str | None = Form(None),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Song:
    """Store a tab PDF as a document-kind song.

    Multipart rather than the base64 JSON that /parse/file takes. That endpoint
    exists to pull text out of a file and discard it; this one exists to keep the
    file, and base64 would inflate a 20MB tab to 27MB on the wire to no purpose.
    """
    get_user_profile(db, current_user, profile_id)

    # Read against the cap rather than reading and then measuring. Starlette spools
    # a large upload to disk, so an unguarded read() would not blow up the process,
    # but it would happily accept a 2GB file and only complain once it was all
    # written down.
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_DOCUMENT_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {MAX_DOCUMENT_BYTES // (1024 * 1024)} MB.",
            )
        chunks.append(chunk)
    data = b"".join(chunks)

    if not data:
        raise HTTPException(status_code=422, detail="File is empty.")

    # The declared content type is whatever the client chose to send, and browsers
    # disagree about PDFs often enough that trusting it means rejecting real files.
    # The header is what actually decides.
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=422, detail="Unsupported file type. PDF only.")

    filename = (file.filename or "document.pdf").strip()[:255]
    resolved_title = (title or "").strip() or re.sub(r"\.pdf$", "", filename, flags=re.IGNORECASE)

    song = Song(
        user_id=current_user.id,
        profile_id=profile_id,
        kind="document",
        title=resolved_title[:500],
        artist=(artist or "").strip()[:500] or None,
        folder=(folder or "").strip()[:100] or None,
        # A document has no chart text. Empty rather than null keeps the columns
        # non-nullable for the charts, where blank content really would be a bug.
        original_content="",
        rewritten_content="",
        status="ready",
        current_version=1,
    )
    db.add(song)
    db.flush()

    # Content-addressed, so uploading a file somebody already holds costs a row
    # rather than another copy of the bytes. That is the common case once tabs are
    # passed between people, and it is also what happens when one person imports
    # the same scan twice.
    digest, size = put_blob(db, data)
    db.add(
        SongFile(
            song_id=song.id,
            filename=filename,
            content_type=DOCUMENT_CONTENT_TYPE,
            size_bytes=size,
            page_count=_document_page_count(data),
            sha256=digest,
        )
    )
    db.commit()
    db.refresh(song)
    return song


@router.get("/songs/{song_ref}/file")
async def download_song_file(
    song_ref: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Serve a stored document's bytes.

    The only route that undefers SongFile.content, which is the point of deferring
    it: reaching the PDF requires asking for this URL.
    """
    song = _resolve_song(db, current_user, song_ref)
    if song.kind != "document":
        raise HTTPException(status_code=404, detail="This song has no stored file.")

    record = db.query(SongFile).filter(SongFile.song_id == song.id).first()
    if record is None:
        raise HTTPException(status_code=404, detail="This song has no stored file.")

    # Content-addressed, so a revalidation after reopening a chart on a phone costs
    # a 304 and no body. Worth the header: this is the request that happens every
    # time you open a tab, over whatever connection the venue has.
    etag = f'"{record.sha256}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})

    # Only now, and only after the 304 has had its chance. This is the single
    # place in the app that loads a stored file's bytes.
    blob = (
        db.query(SongBlob)
        .options(undefer(SongBlob.content))
        .filter(SongBlob.sha256 == record.sha256)
        .first()
    )
    if blob is None:
        raise HTTPException(status_code=404, detail="This song has no stored file.")

    safe_filename = re.sub(r'[\x00-\x1f"\\;]', "", record.filename)
    encoded_filename = quote(record.filename, safe=" -_.!~*'()")

    return Response(
        content=blob.content,
        media_type=record.content_type,
        headers={
            # inline, not attachment: the point is to read it on a music stand, not
            # to land it in a Downloads folder.
            "Content-Disposition": (
                f"inline; filename=\"{safe_filename}\"; filename*=UTF-8''{encoded_filename}"
            ),
            "ETag": etag,
            "Cache-Control": "private, max-age=0, must-revalidate",
        },
    )


@router.get("/songs/{song_ref}", response_model=SongOut)
async def get_song(
    song_ref: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Song:
    return _resolve_song(db, current_user, song_ref)


@router.get("/songs/{song_ref}/pdf")
async def download_song_pdf(
    song_ref: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    song = _resolve_song(db, current_user, song_ref)
    # A document is already a PDF; the one it stored is at /file. Rendering its
    # empty chart text into a blank page instead would be the wrong answer served
    # confidently.
    reject_documents(song, "exported as a chart PDF")
    pdf_bytes = generate_song_pdf(song.title or "Untitled", song.artist, song.rewritten_content)

    title = song.title or "Untitled"
    artist = song.artist or "Unknown"
    raw_filename = f"{title} - {artist}.pdf"
    # Strip characters that break HTTP headers
    safe_filename = re.sub(r'[\x00-\x1f"\\;]', "", raw_filename)
    # RFC 5987 encoded filename for Unicode support
    encoded_filename = quote(raw_filename, safe=" -_.!~*'()")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{safe_filename}\"; filename*=UTF-8''{encoded_filename}"
            )
        },
    )


@router.post("/songs", response_model=SongOut, status_code=201)
async def create_song(
    data: SongCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Song:
    # Verify the profile belongs to this user
    get_user_profile(db, current_user, data.profile_id)

    song = Song(**data.model_dump(), user_id=current_user.id, status="draft", current_version=1)
    db.add(song)
    db.commit()
    db.refresh(song)

    # Create initial revision (version 1)
    revision = SongRevision(
        song_id=song.id,
        version=1,
        rewritten_content=song.rewritten_content,
        changes_summary=song.changes_summary,
        edit_type="full",
    )
    db.add(revision)
    db.commit()

    return song


@router.put("/songs/{song_ref}", response_model=SongOut)
async def update_song(
    song_ref: str,
    data: SongUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Song:
    song = _resolve_song(db, current_user, song_ref)
    # Renaming and filing a document is ordinary library housekeeping, so those
    # fields stay open. Only the text is refused, and only when text was actually
    # sent: a frontend that PUTs the whole song back to change a folder should not
    # be told no because the payload carried two empty strings.
    if song.kind == "document" and (
        data.original_content is not None or data.rewritten_content is not None
    ):
        reject_documents(song, "edited as text")
    if data.title is not None:
        song.title = data.title
    if data.artist is not None:
        song.artist = data.artist
    if data.original_content is not None:
        song.original_content = data.original_content
    if data.rewritten_content is not None:
        song.rewritten_content = data.rewritten_content
    if data.font_size is not None:
        song.font_size = data.font_size if data.font_size > 0 else None
    if data.folder is not None:
        song.folder = data.folder if data.folder != "" else None
    db.commit()
    db.refresh(song)
    return song


@router.delete("/songs/{song_ref}", response_model=OkResponse)
async def delete_song(
    song_ref: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OkResponse:
    song = _resolve_song(db, current_user, song_ref)
    # Read before the delete, because afterwards there is nothing left to ask.
    # Deleting the song cascades to its song_files row; the bytes it pointed at
    # survive if any other song still holds them, and go if none does.
    hashes = hashes_for_songs(db, [song.id])
    db.delete(song)
    db.flush()
    prune_orphan_blobs(db, hashes)
    db.commit()
    return OkResponse(ok=True)


@router.get("/songs/{song_ref}/revisions", response_model=list[SongRevisionOut])
async def list_revisions(
    song_ref: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SongRevision]:
    song = _resolve_song(db, current_user, song_ref)
    revisions = (
        db.query(SongRevision)
        .filter(SongRevision.song_id == song.id)
        .order_by(SongRevision.version.asc())
        .all()
    )
    return revisions


def _display_content(raw: str) -> str:
    """Convert persisted content to display-friendly text.

    Multimodal content is stored as a JSON array; extract the text portions
    for display and use ``[Image]`` as a placeholder for image-only messages.
    """
    if raw.startswith("["):
        try:
            parts = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return raw
        text = " ".join(str(p["text"]) for p in parts if p.get("type") == "text")
        if not text and any(p.get("type") == "image_url" for p in parts):
            return "[Image]"
        return text or raw
    return raw


@router.get("/songs/{song_ref}/messages", response_model=list[ChatMessageOut])
async def list_messages(
    song_ref: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatMessageOut]:
    song = _resolve_song(db, current_user, song_ref)
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.song_id == song.id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
    return [
        ChatMessageOut(
            id=row.id,
            song_id=row.song_id,
            role=row.role,
            content=_display_content(row.content),
            is_note=row.is_note,
            reasoning=row.reasoning,
            model=row.model,
            input_tokens=row.input_tokens,
            output_tokens=row.output_tokens,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.post("/songs/{song_ref}/messages", response_model=list[ChatMessageOut], status_code=201)
async def save_messages(
    song_ref: str,
    messages: list[ChatMessageCreate],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatMessage]:
    song = _resolve_song(db, current_user, song_ref)
    reject_documents(song, "discussed in chat")
    rows = []
    for msg in messages:
        row = ChatMessage(
            song_id=song.id,
            role=msg.role,
            content=msg.content,
            is_note=msg.is_note,
            reasoning=msg.reasoning,
            model=msg.model,
            input_tokens=msg.input_tokens,
            output_tokens=msg.output_tokens,
        )
        db.add(row)
        rows.append(row)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


@router.put("/songs/{song_ref}/status", response_model=SongOut)
async def update_song_status(
    song_ref: str,
    data: SongStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Song:
    song = _resolve_song(db, current_user, song_ref)
    song.status = data.status
    db.commit()
    db.refresh(song)

    return song
