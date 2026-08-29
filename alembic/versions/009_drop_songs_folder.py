"""drop songs.folder, now that song_tags holds it

Separate from 008 on purpose, so that between the two the database is readable by
both the old code and the new, and so 008 can be rolled back without having to
reconstruct anything it threw away.

Revision ID: 009_drop_songs_folder
Revises: 008_song_tags
Create Date: 2026-08-29

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "009_drop_songs_folder"
down_revision: str | Sequence[str] | None = "008_song_tags"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Refuse rather than lose anything. If some filed song never reached
    # song_tags, dropping the column here is the moment its folder stops
    # existing, so stop instead and leave the database in 008's readable state.
    conn = op.get_bind()
    unmigrated = conn.execute(
        sa.text(
            """
            SELECT count(*) FROM songs s
            WHERE s.folder IS NOT NULL AND btrim(s.folder) <> ''
              AND NOT EXISTS (SELECT 1 FROM song_tags t WHERE t.song_id = s.id)
            """
        )
    ).scalar_one()
    if unmigrated:
        raise RuntimeError(
            f"{unmigrated} filed song(s) have no song_tags row. "
            "Re-run 008's backfill before dropping the column."
        )

    op.drop_column("songs", "folder")


def downgrade() -> None:
    # Recreated empty and refilled from the tags. A song with several tags can
    # only have one folder, so the alphabetically first is chosen: any answer
    # loses information, and a deterministic one at least round-trips the
    # single-tag songs that the forward migration created.
    op.add_column("songs", sa.Column("folder", sa.String(), nullable=True))
    op.execute(
        """
        UPDATE songs s
        SET folder = (
            SELECT t.tag FROM song_tags t
            WHERE t.song_id = s.id
            ORDER BY t.tag ASC
            LIMIT 1
        )
        """
    )
