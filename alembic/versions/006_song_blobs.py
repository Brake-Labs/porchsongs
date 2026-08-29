"""content-addressed file storage: song_blobs, with song_files pointing at it

A stored tab was held as bytes on `song_files`, one row per song, so the same
file kept by two people was stored twice. A 25MB scan passed around a jam of six
players was stored six times, and re-importing a file you already had stored it
again.

`song_files.sha256` was already there, computed at upload and used as the
download ETag, so the bytes could already name themselves. This moves them into
`song_blobs` keyed on that hash and turns `song_files.sha256` into the foreign
key. Two songs holding the same file now share one row of bytes.

The backfill collapses duplicates as it goes: `SELECT DISTINCT ON (sha256)`
inserts one blob per distinct hash, whatever the number of song_files rows
carrying it. `song_files.content` is deliberately left in place and dropped by
007, so this migration can be rolled back without having to reconstruct bytes it
threw away, and so a deploy that half-fails still has a readable database.

Revision ID: 006_song_blobs
Revises: 005_song_documents
Create Date: 2026-08-29

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "006_song_blobs"
down_revision: str | Sequence[str] | None = "005_song_documents"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "song_blobs",
        # The hash is the key. Uniqueness of the content is then a property of the
        # schema rather than of every caller remembering to look before inserting.
        sa.Column("sha256", sa.String(length=64), primary_key=True),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
    )

    # One blob per distinct hash. DISTINCT ON needs the ORDER BY to be
    # deterministic, and `id` is the only total order available here; any row with
    # a given hash carries the same bytes, so which one wins does not matter, only
    # that the choice is stable if this is ever re-run.
    op.execute(
        """
        INSERT INTO song_blobs (sha256, content, size_bytes, created_at)
        SELECT DISTINCT ON (sha256) sha256, content, size_bytes, created_at
        FROM song_files
        ORDER BY sha256, id
        """
    )

    # Widen to match the blob key before the foreign key is added. The column was
    # an unbounded String; a hex digest is 64 characters and always was.
    op.alter_column(
        "song_files",
        "sha256",
        existing_type=sa.String(),
        type_=sa.String(length=64),
        existing_nullable=False,
    )
    op.create_index("ix_song_files_sha256", "song_files", ["sha256"])
    op.create_foreign_key(
        "song_files_sha256_fkey", "song_files", "song_blobs", ["sha256"], ["sha256"]
    )

    # Nullable from here on, because 007 drops it and the app has already stopped
    # writing it. Leaving it NOT NULL would make every insert between this
    # migration and that one fail against code that no longer supplies it.
    op.alter_column("song_files", "content", existing_type=sa.LargeBinary(), nullable=True)


def downgrade() -> None:
    # Restoring the bytes is possible only because 006 did not drop them. If 007
    # has run, its downgrade recreates the column empty and this refills it.
    op.execute(
        """
        UPDATE song_files f
        SET content = b.content
        FROM song_blobs b
        WHERE f.sha256 = b.sha256 AND f.content IS NULL
        """
    )
    op.alter_column("song_files", "content", existing_type=sa.LargeBinary(), nullable=False)
    op.drop_constraint("song_files_sha256_fkey", "song_files", type_="foreignkey")
    op.drop_index("ix_song_files_sha256", table_name="song_files")
    op.alter_column(
        "song_files",
        "sha256",
        existing_type=sa.String(length=64),
        type_=sa.String(),
        existing_nullable=False,
    )
    op.drop_table("song_blobs")
