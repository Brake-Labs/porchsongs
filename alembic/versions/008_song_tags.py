"""tags replace folders: a song can carry more than one

A folder held a song in one place at a time, so a tune that is both a fiddle tune
and in Sunday's set meant choosing one. `song_tags` is a join table, so it does
not.

`songs.folder` is backfilled into it and then left alone; 009 drops the column.
Same two-step as the blob migration, and for the same reason: between the two the
database reads correctly under both the old code and the new, and 008 is
reversible without reconstructing anything.

Revision ID: 008_song_tags
Revises: 007_drop_song_files_content
Create Date: 2026-08-29

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "008_song_tags"
down_revision: str | Sequence[str] | None = "007_drop_song_files_content"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "song_tags",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "song_id",
            sa.Integer(),
            sa.ForeignKey("songs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tag", sa.String(length=100), nullable=False),
        # The same tag twice on one song is not a state anything downstream
        # should have to cope with.
        sa.UniqueConstraint("song_id", "tag", name="ux_song_tags_song_tag"),
    )
    op.create_index("ix_song_tags_song_id", "song_tags", ["song_id"])
    # The tag filter reads this: "every song of mine carrying X". Without it that
    # is a sequential scan of every tag row in the table.
    op.create_index("ix_song_tags_tag", "song_tags", ["tag"])

    # One tag per filed song. Trimmed and length-capped to match the column, and
    # blank-folder rows are skipped: `folder = ''` was reachable through the old
    # API and means unfiled, not a tag whose name is the empty string.
    op.execute(
        """
        INSERT INTO song_tags (song_id, tag)
        SELECT id, left(btrim(folder), 100)
        FROM songs
        WHERE folder IS NOT NULL AND btrim(folder) <> ''
        """
    )


def downgrade() -> None:
    op.drop_index("ix_song_tags_tag", table_name="song_tags")
    op.drop_index("ix_song_tags_song_id", table_name="song_tags")
    op.drop_table("song_tags")
