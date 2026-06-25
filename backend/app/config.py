from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://porchsongs:porchsongs@localhost:5432/porchsongs"
    cors_origins: str = "*"
    jwt_secret: str = "change-me-in-production"
    jwt_expiry_minutes: int = 15
    refresh_token_days: int = 30
    premium_plugin: str | None = None
    default_max_tokens: int = 32768
    # Base URL for all LLM traffic. When set, every LLM call is routed through
    # this gateway; when unset, calls use each provider's default endpoint.
    # This is the sole source of api_base: per-profile provider connections are
    # not consulted for routing.
    llm_api_base: str | None = None
    # API key for all LLM traffic, the matched pair to llm_api_base. When set,
    # it authenticates every LLM call regardless of provider; when unset, the
    # key is None and any-llm falls back to its per-provider env var resolution
    # (e.g. ANTHROPIC_API_KEY). The per-request key is not consulted.
    llm_api_key: str | None = None

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
