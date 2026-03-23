from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# --- Users ---
class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Profiles ---
class ProfileCreate(BaseModel):
    is_default: bool = False
    system_prompt_parse: str | None = None
    system_prompt_chat: str | None = None
    platform_key_disabled: bool = False


class ProfileUpdate(BaseModel):
    is_default: bool | None = None
    system_prompt_parse: str | None = None
    system_prompt_chat: str | None = None
    platform_key_disabled: bool | None = None


class ProfileOut(BaseModel):
    id: int
    user_id: int
    is_default: bool
    system_prompt_parse: str | None = None
    system_prompt_chat: str | None = None
    platform_key_disabled: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# --- Profile Models ---
class ProfileModelCreate(BaseModel):
    provider: str
    model: str
    api_base: str | None = None


class ProfileModelOut(BaseModel):
    id: int
    profile_id: int
    provider: str
    model: str
    api_base: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Provider Connections ---
class ProviderConnectionCreate(BaseModel):
    provider: str
    api_base: str | None = None


class ProviderConnectionOut(BaseModel):
    id: int
    profile_id: int
    provider: str
    api_base: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int | None = None
    cache_read_input_tokens: int | None = None


# --- Parse ---
class ParseRequest(BaseModel):
    profile_id: int
    content: str = Field(max_length=100_000)
    provider: str
    model: str
    reasoning_effort: str | None = None
    instruction: str | None = Field(default=None, max_length=2000)
    max_tokens: int | None = None
    api_key: str | None = None


class ParseResponse(BaseModel):
    original_content: str
    title: str | None = None
    artist: str | None = None
    reasoning: str | None = None
    usage: TokenUsage | None = None


# --- Songs ---
class SongCreate(BaseModel):
    profile_id: int
    title: str | None = Field(default=None, max_length=500)
    artist: str | None = Field(default=None, max_length=500)
    source_url: str | None = None
    original_content: str = Field(max_length=100_000)
    rewritten_content: str = Field(max_length=100_000)
    changes_summary: str | None = None
    llm_provider: str | None = None
    llm_model: str | None = None
    folder: str | None = Field(default=None, max_length=100)


class SongOut(BaseModel):
    id: int
    uuid: str
    user_id: int
    profile_id: int
    title: str | None
    artist: str | None
    source_url: str | None
    original_content: str
    rewritten_content: str
    changes_summary: str | None
    llm_provider: str | None
    llm_model: str | None
    font_size: float | None = None
    folder: str | None = None
    status: str
    current_version: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# --- Song Revisions ---
class SongRevisionOut(BaseModel):
    id: int
    song_id: int
    version: int
    rewritten_content: str
    changes_summary: str | None
    edit_type: Literal["full", "chat"]
    edit_context: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class SongUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=500)
    artist: str | None = Field(default=None, max_length=500)
    original_content: str | None = Field(default=None, max_length=100_000)
    rewritten_content: str | None = Field(default=None, max_length=100_000)
    font_size: float | None = Field(default=None, ge=0, le=100)
    folder: str | None = Field(default=None, max_length=100)


class FolderRename(BaseModel):
    name: str = Field(min_length=1, max_length=100)


# --- Song Status ---
class SongStatusUpdate(BaseModel):
    status: Literal["draft", "completed"]


# --- Chat ---
class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str | list[dict[str, object]]


class ChatMessageCreate(BaseModel):
    role: str
    content: str = Field(max_length=10_000)
    is_note: bool = False
    reasoning: str | None = None
    model: str | None = None


class ChatMessageOut(BaseModel):
    id: int
    song_id: int
    role: str
    content: str
    is_note: bool
    reasoning: str | None = None
    model: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatRequest(BaseModel):
    song_id: int
    messages: list[ChatMessage]
    provider: str
    model: str
    reasoning_effort: str | None = None
    max_tokens: int | None = None
    api_key: str | None = None


class ChatResponse(BaseModel):
    rewritten_content: str | None = None
    original_content: str | None = None
    assistant_message: str
    changes_summary: str
    version: int
    reasoning: str | None = None
    usage: TokenUsage | None = None


# --- Generic response models for OpenAPI spec ---
class OkResponse(BaseModel):
    ok: bool


class HealthResponse(BaseModel):
    status: str
    version: str


class DefaultPromptsResponse(BaseModel):
    parse: str
    chat: str


class ProviderInfo(BaseModel):
    name: str
    local: bool


class ProvidersResponse(BaseModel):
    providers: list[ProviderInfo]
    platform_enabled: bool
