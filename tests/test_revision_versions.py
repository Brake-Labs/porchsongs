"""Revision numbering: one revision per (song_id, version), bumped atomically.

The background finisher for a disconnected chat stream and the user's next chat
request can persist a turn for the same song at the same time. Both used to read
``current_version``, add one in Python, and insert a revision claiming the same
number.
"""

import threading
from collections.abc import Generator
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.models import Profile, Song, SongRevision, User
from app.services.chat_turn import persist_chat_result

REPO_ROOT = Path(__file__).resolve().parent.parent


def _make_song(db: Session, user: User) -> Song:
    profile = Profile(user_id=user.id, is_default=True)
    db.add(profile)
    db.flush()
    song = Song(
        user_id=user.id,
        profile_id=profile.id,
        original_content="Hello",
        rewritten_content="Hello",
        current_version=1,
    )
    db.add(song)
    db.flush()
    db.add(SongRevision(song_id=song.id, version=1, rewritten_content="Hello"))
    db.commit()
    return song


def _persist(db: Session, song_id: int, content: str) -> int:
    song = db.get(Song, song_id)
    assert song is not None
    return persist_chat_result(
        db,
        song,
        rewritten_content=content,
        changes_summary="edit",
        assistant_content=content,
    )


def test_concurrent_persists_get_distinct_sequential_versions(
    db_engine: Engine, db_session: Session, test_user: User
) -> None:
    """Two writers that both loaded the song at version 1 end at 2 and 3."""
    song_id = _make_song(db_session, test_user).id
    factory = sessionmaker(bind=db_engine)

    first = factory()
    second = factory()
    try:
        # Both writers have read the song before either commits, which is the
        # window the old read-then-add code lost.
        assert first.get(Song, song_id).current_version == 1  # type: ignore[union-attr]
        assert second.get(Song, song_id).current_version == 1  # type: ignore[union-attr]

        assert _persist(first, song_id, "first") == 2

        result: dict[str, int] = {}
        errors: list[BaseException] = []

        def run_second() -> None:
            try:
                result["version"] = _persist(second, song_id, "second")
                second.commit()
            except BaseException as e:
                errors.append(e)

        worker = threading.Thread(target=run_second)
        worker.start()
        # The second bump waits on the first writer's row lock. If it finished
        # here it would have read version 1 and claimed 2 as well.
        worker.join(timeout=0.5)
        assert worker.is_alive(), "second persist did not wait for the first to commit"

        first.commit()
        worker.join(timeout=10)
        assert not worker.is_alive()
        assert not errors, errors
        assert result["version"] == 3
    finally:
        first.close()
        second.close()

    db_session.expire_all()
    song = db_session.get(Song, song_id)
    assert song is not None
    assert song.current_version == 3
    assert song.rewritten_content == "second"
    versions = [
        v
        for (v,) in db_session.query(SongRevision.version)
        .filter(SongRevision.song_id == song_id)
        .order_by(SongRevision.version)
    ]
    assert versions == [1, 2, 3]


def test_persist_without_new_content_keeps_version(db_session: Session, test_user: User) -> None:
    song_id = _make_song(db_session, test_user).id
    song = db_session.get(Song, song_id)
    assert song is not None
    version = persist_chat_result(
        db_session, song, rewritten_content=None, changes_summary="", assistant_content="hi"
    )
    db_session.commit()
    assert version == 1
    assert db_session.query(SongRevision).filter(SongRevision.song_id == song_id).count() == 1


def test_duplicate_revision_version_is_rejected(db_session: Session, test_user: User) -> None:
    song_id = _make_song(db_session, test_user).id
    db_session.add(SongRevision(song_id=song_id, version=1, rewritten_content="dupe"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


# --- Migration 010 ---


@pytest.fixture()
def migration_db(db_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Generator[Engine]:
    """A scratch database that only Alembic touches.

    The shared test database is built with ``create_all``, so it has no alembic
    history to migrate from.
    """
    from app.config import settings

    url = make_url(db_engine.url.render_as_string(hide_password=False))
    name = f"{url.database}_migrations"
    admin = sa.create_engine(url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(sa.text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        conn.execute(sa.text(f'CREATE DATABASE "{name}"'))
    scratch_url = url.set(database=name)
    # env.py reads the URL from settings each time a command runs.
    monkeypatch.setattr(settings, "database_url", scratch_url.render_as_string(False))
    engine = sa.create_engine(scratch_url)
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(sa.text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def _alembic_config() -> Config:
    # No ini file, so env.py skips fileConfig and leaves pytest's logging alone.
    cfg = Config()
    cfg.set_main_option("script_location", str(REPO_ROOT / "alembic"))
    return cfg


def test_migration_renumbers_duplicates_and_round_trips(migration_db: Engine) -> None:
    cfg = _alembic_config()
    command.upgrade(cfg, "009_drop_songs_folder")

    with migration_db.begin() as conn:
        user_id = conn.execute(
            sa.text(
                "INSERT INTO users (email, name, role, is_active, created_at) "
                "VALUES ('m@x', 'M', 'user', true, now()) RETURNING id"
            )
        ).scalar_one()
        profile_id = conn.execute(
            sa.text(
                "INSERT INTO profiles (user_id, is_default, created_at, updated_at) "
                "VALUES (:u, true, now(), now()) RETURNING id"
            ),
            {"u": user_id},
        ).scalar_one()

        def song(current: int) -> int:
            return conn.execute(
                sa.text(
                    "INSERT INTO songs (user_id, profile_id, uuid, original_content, "
                    "rewritten_content, status, current_version, kind, created_at, updated_at) "
                    "VALUES (:u, :p, gen_random_uuid()::text, '', '', 'draft', :c, 'chart', "
                    "now(), now()) RETURNING id"
                ),
                {"u": user_id, "p": profile_id, "c": current},
            ).scalar_one()

        def revisions(song_id: int, versions: list[int]) -> None:
            for v in versions:
                conn.execute(
                    sa.text(
                        "INSERT INTO song_revisions (song_id, version, rewritten_content, "
                        "edit_type, created_at) VALUES (:s, :v, :c, 'chat', now())"
                    ),
                    {"s": song_id, "v": v, "c": f"v{v}"},
                )

        # The race: two persists both claimed version 2 and left the counter at 2.
        raced = song(current=2)
        revisions(raced, [1, 2, 2, 3])
        clean = song(current=3)
        revisions(clean, [1, 2, 3])

    command.upgrade(cfg, "010_song_revision_version_unique")

    with migration_db.connect() as conn:

        def versions_of(song_id: int) -> list[tuple[int, str]]:
            rows = conn.execute(
                sa.text(
                    "SELECT version, rewritten_content FROM song_revisions "
                    "WHERE song_id = :s ORDER BY version"
                ),
                {"s": song_id},
            )
            return [(r[0], r[1]) for r in rows]

        def current_of(song_id: int) -> int:
            return conn.execute(
                sa.text("SELECT current_version FROM songs WHERE id = :s"), {"s": song_id}
            ).scalar_one()

        # Every row kept, in its original order, numbered 1..n.
        assert versions_of(raced) == [(1, "v1"), (2, "v2"), (3, "v2"), (4, "v3")]
        assert current_of(raced) == 4
        assert versions_of(clean) == [(1, "v1"), (2, "v2"), (3, "v3")]
        assert current_of(clean) == 3

    with pytest.raises(IntegrityError), migration_db.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO song_revisions (song_id, version, rewritten_content, edit_type, "
                "created_at) VALUES (:s, 1, 'dupe', 'chat', now())"
            ),
            {"s": clean},
        )

    command.downgrade(cfg, "009_drop_songs_folder")
    with migration_db.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO song_revisions (song_id, version, rewritten_content, edit_type, "
                "created_at) VALUES (:s, 1, 'dupe', 'chat', now())"
            ),
            {"s": clean},
        )
