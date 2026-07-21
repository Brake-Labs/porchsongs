"""Shared fixtures for tests."""

import os
from collections.abc import Generator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.auth.dependencies import get_current_user
from app.database import Base, get_db
from app.main import app
from app.models import User

TEST_DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/porchsongs_test",
)


@pytest.fixture(scope="session")
def db_engine() -> Generator[Engine]:
    """Create a PostgreSQL engine shared across the entire test session."""
    engine = create_engine(TEST_DATABASE_URL)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def _clean_tables(db_engine: Engine) -> None:
    """Truncate all tables before a test for isolation."""
    with db_engine.connect() as conn:
        table_names = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
        if table_names:
            conn.execute(text(f"TRUNCATE {table_names} RESTART IDENTITY CASCADE"))
            conn.commit()


@pytest.fixture(autouse=True)
def _configure_gateway() -> Generator[None]:
    """Point the app at a dummy LLM gateway so rewrite endpoints don't 503.

    porchsongs is gateway-only: ``_require_gateway`` returns 503 when
    ``llm_api_base`` is unset. Tests mock the LLM call itself, so they only
    need the gateway settings to be present.
    """
    from app.config import settings

    orig_base, orig_key = settings.llm_api_base, settings.llm_api_key
    settings.llm_api_base = "https://gateway.test/v1"
    settings.llm_api_key = "test-gateway-key"
    yield
    settings.llm_api_base, settings.llm_api_key = orig_base, orig_key


@pytest.fixture()
def db_session(db_engine: Engine, _clean_tables: None) -> Generator[Session]:
    """Create a PostgreSQL session for each test."""
    session_factory = sessionmaker(bind=db_engine)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def test_user(db_session: Session) -> User:
    """Create a test user and return it."""
    user = User(
        email="test@porchsongs.local",
        name="Test User",
        role="admin",
        is_active=True,
        created_at=datetime.now(UTC),
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture()
def client(db_session: Session, test_user: User) -> Generator[TestClient]:
    """FastAPI test client with overridden DB dependency and auth."""

    def _override_get_db() -> Generator[Session]:
        try:
            yield db_session
        finally:
            pass

    def _override_get_current_user() -> User:
        return test_user

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_get_current_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
