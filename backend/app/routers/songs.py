import io
import json
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session, load_only, undefer

from ..auth.dependencies import get_current_user
from ..auth.scoping import get_user_profile, get_user_song, get_user_song_by_uuid
from ..database import get_db
from ..models import (
    ChatMessage,
    Song,
    SongBlob,
    SongFile,
    SongRevision,
    SongTag,
    User,
)
from ..schemas import (
    ArtistRename,
    ArtistRenameResult,
    ChatMessageCreate,
    ChatMessageOut,
    OkResponse,
    SongCreate,
    SongOut,
    SongRevisionOut,
    SongStatusUpdate,
    SongUpdate,
    TagOut,
    TagRename,
)
from ..services.blob_store import hashes_for_songs, prune_orphan_blobs, put_blob
from ..services.pdf_service import generate_song_pdf
from ..services.tags import artist_key, normalise, normalise_artist, set_tags, user_tags

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


# What the library sends to mean "songs carrying no tags at all".
UNTAGGED = "__untagged__"


@router.get("/songs", response_model=list[SongOut])
async def list_songs(
    profile_id: int | None = None,
    search: str | None = None,
    tags: list[str] | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Song]:
    query = db.query(Song).filter(Song.user_id == current_user.id)
    if profile_id is not None:
        query = query.filter(Song.profile_id == profile_id)
    if search:
        pattern = f"%{search}%"
        query = query.filter((Song.title.ilike(pattern)) | (Song.artist.ilike(pattern)))

    if tags:
        if UNTAGGED in tags:
            # Untagged is not a tag, so it cannot be combined with one: no song is
            # both untagged and tagged, and returning nothing would look broken.
            # It wins, and the rest are ignored.
            query = query.filter(~Song.tag_rows.any())
        else:
            # Every selected tag, not any: each one you add narrows the list, which
            # is what a tag row is for once a library is big enough to need one.
            # One EXISTS per tag rather than a join and a count, so the planner can
            # use ix_song_tags_tag for each and stop at the first miss.
            for tag in tags:
                cleaned = normalise(tag)
                if not cleaned:
                    continue
                query = query.filter(Song.tag_rows.any(func.lower(SongTag.tag) == cleaned.lower()))

    return query.order_by(Song.created_at.desc()).all()


@router.get("/songs/tags", response_model=list[TagOut])
async def list_tags(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TagOut]:
    """Every tag this user has, with how many songs carry it.

    The count is what lets the library show "Fiddle Tunes 12" and what tells a
    tag editor whether a tag it is about to create is new.
    """
    return [TagOut(tag=tag, count=count) for tag, count in user_tags(db, current_user.id)]


@router.put("/songs/tags/{tag_name}", response_model=OkResponse)
async def rename_tag(
    tag_name: str,
    data: TagRename,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OkResponse:
    """Rename a tag everywhere it appears."""
    new_name = normalise(data.name)
    if not new_name:
        raise HTTPException(status_code=422, detail="A tag needs a name.")

    rows = (
        db.query(SongTag)
        .join(Song, Song.id == SongTag.song_id)
        .filter(Song.user_id == current_user.id, func.lower(SongTag.tag) == tag_name.lower())
        .all()
    )
    # A song already carrying the destination would end up with it twice, which
    # the unique constraint refuses. Drop the duplicate rather than fail the
    # rename: merging two tags is a reasonable thing to have meant.
    already = {
        row.song_id
        for row in db.query(SongTag)
        .join(Song, Song.id == SongTag.song_id)
        .filter(Song.user_id == current_user.id, func.lower(SongTag.tag) == new_name.lower())
        .all()
    }
    for row in rows:
        if row.song_id in already:
            db.delete(row)
        else:
            row.tag = new_name
    db.commit()
    return OkResponse(ok=True)


@router.put("/songs/artists", response_model=ArtistRenameResult)
async def rename_artist(
    data: ArtistRename,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ArtistRenameResult:
    """Rename an artist across every song of theirs.

    The counterpart to `rename_tag`, but writing a column on `songs` rather than
    rows in a join table: an artist is a property of the song, not a label
    attached to it.

    Both names travel in the body, where `rename_tag` takes the old one as a path
    segment. An artist called "AC/DC" cannot survive a path: ASGI decodes %2F
    before routing, so the request arrives with an extra segment and is answered
    405 before this function sees it.

    Renaming onto a name already in use merges the two. The counts come back so
    the client can say which happened. Matching folds case and collapses inner
    whitespace; see `artist_key`.
    """
    new_name = normalise_artist(data.name)
    if not new_name:
        raise HTTPException(status_code=422, detail="An artist needs a name.")

    wanted = artist_key(data.from_name)
    if not wanted:
        # The library's Unknown bucket is not an artist and has no name to change.
        # Giving those songs an artist is what the tidy screen is for.
        raise HTTPException(status_code=422, detail="That is not an artist you can rename.")

    # Only the two columns this reads and writes. The default load drags every
    # chart's full text along to compare one string.
    songs = (
        db.query(Song)
        .options(load_only(Song.id, Song.artist))
        .filter(Song.user_id == current_user.id)
        .all()
    )
    renamed = 0
    merged_into = 0
    for song in songs:
        key = artist_key(song.artist)
        if key == wanted:
            song.artist = new_name
            renamed += 1
        elif key == artist_key(new_name):
            merged_into += 1

    if renamed == 0:
        raise HTTPException(status_code=404, detail="No songs by that artist.")

    db.commit()
    return ArtistRenameResult(name=new_name, renamed=renamed, merged_into=merged_into)


@router.delete("/songs/tags/{tag_name}", response_model=OkResponse)
async def delete_tag(
    tag_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OkResponse:
    """Remove a tag from every song that carries it.

    Never touches a song. That is a property of the shape rather than a promise
    this endpoint makes: the tag lives in its own table, so deleting it is a
    delete of those rows and nothing else.
    """
    ids = [
        row.id
        for row in db.query(SongTag.id)
        .join(Song, Song.id == SongTag.song_id)
        .filter(Song.user_id == current_user.id, func.lower(SongTag.tag) == tag_name.lower())
        .all()
    ]
    if ids:
        db.query(SongTag).filter(SongTag.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
    return OkResponse(ok=True)


@router.post("/songs/documents", response_model=SongOut, status_code=201)
async def upload_document(
    profile_id: int = Form(...),
    title: str | None = Form(None),
    artist: str | None = Form(None),
    tags: str | None = Form(None),
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
        # A document has no chart text. Empty rather than null keeps the columns
        # non-nullable for the charts, where blank content really would be a bug.
        original_content="",
        rewritten_content="",
        status="ready",
        current_version=1,
    )
    db.add(song)
    db.flush()
    if tags:
        # Comma separated, because this is a multipart form and a repeated field
        # is awkward to build from a FormData in the browser.
        set_tags(db, song, tags.split(","))

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

    payload = data.model_dump()
    # `tags` is a read-only view over the join rows, so it cannot be passed to the
    # constructor. Pulled out and applied through the service, which is also what
    # normalises and de-duplicates it.
    tags = payload.pop("tags", [])
    song = Song(**payload, user_id=current_user.id, status="draft", current_version=1)
    db.add(song)
    db.flush()
    set_tags(db, song, tags)
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
    # Renaming and tagging a document is ordinary library housekeeping, so those
    # fields stay open. Only the text is refused, and only when text was actually
    # sent: a frontend that PUTs the whole song back to change a tag should not be
    # told no because the payload carried two empty strings.
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
    if data.tags is not None:
        set_tags(db, song, data.tags)
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
