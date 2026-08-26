import uuid as _uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text
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
    # SongFile.content being deferred: this loads the metadata the library shows
    # and leaves the bytes in the database until something names them.
    file: Mapped["SongFile | None"] = relationship(
        "SongFile",
        back_populates="song",
        cascade="all, delete-orphan",
        uselist=False,
        lazy="selectin",
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


class SongFile(Base):
    """The stored bytes of a document-kind song: a tab PDF you keep and play from.

    A separate table rather than a column on `songs` so that binary can never be
    dragged into a library listing by accident. `list_songs` returns a full
    serialisation of every row it selects, and a personal tab collection is
    hundreds of megabytes; keeping the bytes one join away means the only way to
    load them is to ask for them by name.

    One row per song, enforced by the unique constraint on `song_id`. Replacing a
    file replaces the row, so `sha256` and `size_bytes` always describe the bytes
    currently in `content` rather than whatever was uploaded first.
    """

    __tablename__ = "song_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    song_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("songs.id"), unique=True, index=True, nullable=False
    )
    # Deferred: the second guard, and the one that survives a careless query. Even
    # when the row is loaded to read `page_count` for a library listing, the bytes
    # stay in the database until something asks for this attribute by name.
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, deferred=True)
    # The name the file arrived with, kept for the download filename only.
    filename: Mapped[str] = mapped_column(String, nullable=False)
    content_type: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    # Page count, read once at upload. The library shows it, and computing it on
    # read would mean loading the whole PDF to render a number in a list.
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Hex digest of `content`, serving as the download ETag. Reopening a tab on a
    # music stand should not refetch several megabytes over a phone connection.
    sha256: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    song: Mapped["Song"] = relationship("Song", back_populates="file")
