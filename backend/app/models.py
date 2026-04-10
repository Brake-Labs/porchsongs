import uuid as _uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
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
    connections: Mapped[list["ProviderConnection"]] = relationship(
        "ProviderConnection", back_populates="profile", cascade="all, delete-orphan"
    )
    models: Mapped[list["ProfileModel"]] = relationship(
        "ProfileModel", back_populates="profile", cascade="all, delete-orphan"
    )


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


class ProviderConnection(Base):
    __tablename__ = "provider_connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("profiles.id"), index=True, nullable=False
    )
    provider: Mapped[str] = mapped_column(String, nullable=False)
    api_base: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    profile: Mapped["Profile"] = relationship("Profile", back_populates="connections")


class ProfileModel(Base):
    __tablename__ = "profile_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("profiles.id"), index=True, nullable=False
    )
    provider: Mapped[str] = mapped_column(String, nullable=False)
    model: Mapped[str] = mapped_column(String, nullable=False)
    api_base: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    profile: Mapped["Profile"] = relationship("Profile", back_populates="models")
