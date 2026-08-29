"""drop song_files.content, now that song_blobs holds the bytes

Separate from 006 on purpose. 006 copies the bytes into `song_blobs` and leaves
the old column in place, so that between the two the database is readable by both
the old code and the new. This one removes the duplicate, and is safe to run only
once every process is serving from `song_blobs`.

Splitting it also makes 006 reversible without data loss, which a single
migration that copied and dropped in one step would not be.

Revision ID: 007_drop_song_files_content
Revises: 006_song_blobs
Create Date: 2026-08-29

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "007_drop_song_files_content"
down_revision: str | Sequence[str] | None = "006_song_blobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Refuse rather than lose anything. If some row's bytes never reached
    # song_blobs, dropping the column here is the moment they stop existing, so
    # the migration stops instead and leaves the database in 006's readable state.
    conn = op.get_bind()
    unmigrated = conn.execute(
        sa.text(
            """
            SELECT count(*) FROM song_files f
            LEFT JOIN song_blobs b ON b.sha256 = f.sha256
            WHERE b.sha256 IS NULL
            """
        )
    ).scalar_one()
    if unmigrated:
        raise RuntimeError(
            f"{unmigrated} song_files row(s) have no matching song_blobs row. "
            "Re-run 006's backfill before dropping the column."
        )

    op.drop_column("song_files", "content")


def downgrade() -> None:
    # Recreated nullable and empty. 006's downgrade is what refills it from the
    # blobs, so the pair reverses cleanly in either order.
    op.add_column("song_files", sa.Column("content", sa.LargeBinary(), nullable=True))
