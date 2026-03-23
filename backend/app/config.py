from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://porchsongs:porchsongs@localhost:5432/porchsongs"
    cors_origins: str = "*"
    jwt_secret: str = "change-me-in-production"
    jwt_expiry_minutes: int = 15
    refresh_token_days: int = 30
    premium_plugin: str | None = None
    default_max_tokens: int = 32768

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
