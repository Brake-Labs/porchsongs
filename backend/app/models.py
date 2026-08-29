import uuid as _uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, default="user")  # "admin" or "user"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    terms_accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    profiles: Mapped[list["Profile"]] = relationship(
        "Profile", back_populates="user", cascade="all, delete-orphan"
    )
    songs: Mapped[list["Song"]] = relationship(
        "Song", back_populates="user", cascade="all, delete-orphan"
    )
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        "RefreshToken", back_populates="user", cascade="all, delete-orphan"
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), index=True, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    user: Mapped["User"] = relationship("User", back_populates="refresh_tokens")


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), index=True, nullable=False
    )
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    system_prompt_parse: Mapped[str | None] = mapped_column(Text, nullable=True)
    system_prompt_chat: Mapped[str | None] = mapped_column(Text, nullable=True)
    platform_key_disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    user: Mapped["User"] = relationship("User", back_populates="profiles")


class Song(Base):
    __tablename__ = "songs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String, unique=True, index=True, nullable=False, default=lambda: str(_uuid.uuid4())
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), index=True, nullable=False
    )
    profile_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("profiles.id"), index=True, nullable=False
    )
    # "chart" is a chord chart held as text; "document" is a stored file (a tab PDF)
    # that the library shows and PlayView renders, and that nothing rewrites. The
    # text columns stay empty for a document, so every text feature keys off this
    # rather than off whether the content happens to be blank.
    kind: Mapped[str] = mapped_column(String, default="chart", nullable=False)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    artist: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_content: Mapped[str] = mapped_column(Text, nullable=False)
    rewritten_content: Mapped[str] = mapped_column(Text, nullable=False)
    changes_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_provider: Mapped[str | None] = mapped_column(String, nullable=True)
    llm_model: Mapped[str | None] = mapped_column(String, nullable=True)
    # Kept until migration 009 drops it. 008 backfills `song_tags` from it and
    # leaves it alone, so the database reads correctly under both the old code and
    # the new; see the migration.
    folder: Mapped[str | None] = mapped_column(String, nullable=True)
    font_size: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String, default="draft")
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    user: Mapped["User"] = relationship("User", back_populates="songs")
    revisions: Mapped[list["SongRevision"]] = relationship(
        "SongRevision", back_populates="song", cascade="all, delete-orphan"
    )
    chat_messages: Mapped[list["ChatMessage"]] = relationship(
        "ChatMessage", back_populates="song", cascade="all, delete-orphan"
    )
    # selectin, so listing a library of documents costs one extra query in total
    # rather than one per row. What keeps the PDFs themselves out of that query is
    # that the bytes are not on this table at all: this loads the metadata the
    # library shows and leaves song_blobs untouched until something names it.
    file: Mapped["SongFile | None"] = relationship(
        "SongFile",
        back_populates="song",
        cascade="all, delete-orphan",
        uselist=False,
        lazy="selectin",
    )
    # selectin for the same reason as `file`: a library listing shows every song's
    # tags, and lazy loading them would be one query per row.
    tag_rows: Mapped[list["SongTag"]] = relationship(
        "SongTag",
        back_populates="song",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="SongTag.tag",
    )

    @property
    def tags(self) -> list[str]:
        """The tag names, sorted. What the API serialises and the UI renders."""
        return [row.tag for row in self.tag_rows]


class SongTag(Base):
    """One tag on one song.

    Replaces `songs.folder`, and the join table is the whole point: a folder held
    a song in one place at a time, so filing a tune that is both a fiddle tune and
    in Sunday's set meant choosing. A song can carry as many of these as it likes.

    The tag is text on this row rather than a foreign key to a `tags` table. There
    is no other fact about a tag: it has no colour, no description, no ordering,
    and no identity beyond its name, so a second table would exist only to hold
    the same string once. Renaming is one UPDATE either way, and "what tags does
    this user have" is a DISTINCT over the rows they own.

    Deleting a tag cannot touch a song, which is a property of the shape rather
    than a promise the delete endpoint makes. That was not true of folders: the
    column lived on `songs`, so clearing it was a write to the song itself.
    """

    __tablename__ = "song_tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    song_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("songs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    tag: Mapped[str] = mapped_column(String(100), nullable=False, index=True)

    song: Mapped["Song"] = relationship("Song", back_populates="tag_rows")

    __table_args__ = (
        # The same tag twice on one song is not a state anything should have to
        # cope with downstream.
        UniqueConstraint("song_id", "tag", name="ux_song_tags_song_tag"),
    )


class SongRevision(Base):
    __tablename__ = "song_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    song_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("songs.id"), index=True, nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    rewritten_content: Mapped[str] = mapped_column(Text, nullable=False)
    changes_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    edit_type: Mapped[str] = mapped_column(String, default="full")  # "full" or "chat"
    edit_context: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    song: Mapped["Song"] = relationship("Song", back_populates="revisions")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    song_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("songs.id"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_note: Mapped[bool] = mapped_column(Boolean, default=False)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    model: Mapped[str | None] = mapped_column(String, nullable=True, default=None)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    song: Mapped["Song"] = relationship("Song", back_populates="chat_messages")


class SongBlob(Base):
    """File bytes, addressed by their own hash.

    Split out of `song_files` so that one set of bytes can back many songs. Two
    people keeping the same tab, or one person who imported it twice, previously
    stored it twice; a 25MB scan passed around a jam of six was stored six times.
    Now the second and every later copy is a row pointing at bytes that are
    already here.

    The primary key is the hash of the content, which is what makes that work:
    there is no way to hold two rows for the same bytes, because the bytes name
    the row. `song_files.sha256` was already computed and stored for the download
    ETag, so nothing new has to be calculated to find the match.

    Nothing here says who owns the bytes. Ownership lives in `song_files`, one row
    per song, and a blob is reachable only through one of those. Deleting the last
    song that points at a blob is what removes it: see `prune_orphan_blobs`.
    """

    __tablename__ = "song_blobs"

    # 64 hex characters of SHA-256. The key rather than a surrogate id, so the
    # uniqueness of the content is enforced by the schema and not by a lookup that
    # some future caller forgets to do.
    sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Deferred for the same reason it was deferred on song_files: loading a row to
    # read its size must not drag megabytes along with it.
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, deferred=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


class SongFile(Base):
    """One song's claim on a stored file: a tab PDF you keep and play from.

    A separate table rather than a column on `songs` so that binary can never be
    dragged into a library listing by accident. `list_songs` returns a full
    serialisation of every row it selects, and a personal tab collection is
    hundreds of megabytes; keeping the bytes two joins away means the only way to
    load them is to ask for them by name.

    One row per song, enforced by the unique constraint on `song_id`. The bytes
    themselves are in `song_blobs`, shared with any other song holding the same
    file. Everything that differs between two songs holding the same bytes lives
    here: the filename it arrived with is the obvious one, since the same tab can
    reach two people under two names.
    """

    __tablename__ = "song_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    song_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("songs.id"), unique=True, index=True, nullable=False
    )
    # The name the file arrived with, kept for the download filename only.
    filename: Mapped[str] = mapped_column(String, nullable=False)
    content_type: Mapped[str] = mapped_column(String, nullable=False)
    # Denormalised from the blob. The library lists it, and the whole point of this
    # table is that a listing never has to touch song_blobs at all.
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    # Page count, read once at upload. The library shows it, and computing it on
    # read would mean loading the whole PDF to render a number in a list.
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Hex digest of the bytes, and the foreign key to them. Also the download ETag:
    # reopening a tab on a music stand should not refetch several megabytes over
    # whatever connection the venue has.
    sha256: Mapped[str] = mapped_column(
        String(64), ForeignKey("song_blobs.sha256"), index=True, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    song: Mapped["Song"] = relationship("Song", back_populates="file")
    blob: Mapped["SongBlob"] = relationship("SongBlob")
