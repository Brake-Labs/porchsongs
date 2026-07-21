from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://porchsongs:porchsongs@localhost:5432/porchsongs"
    cors_origins: str = "*"
    jwt_secret: str = "change-me-in-production"
    jwt_expiry_minutes: int = 15
    refresh_token_days: int = 30
    premium_plugin: str | None = None
    default_max_tokens: int = 32768

    # ── LLM gateway ────────────────────────────────────────────────────────
    # porchsongs routes all AI traffic through a single any-llm gateway provider
    # (Otari by default). The model list, generation, and model discovery all go
    # through LLM_API_BASE using LLM_API_KEY. When llm_api_base is unset the app
    # has no LLM backend configured and rewrite endpoints return 503.
    llm_provider: str = "otari"
    llm_api_base: str | None = None
    llm_api_key: str | None = None

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
