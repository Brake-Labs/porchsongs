"""store tab documents: songs.kind plus a song_files table

porchsongs held a song as text and nothing else. A stored tab is a file you keep
and play from, never rewrite, so it arrives as a song with `kind="document"`,
empty text columns, and one row in `song_files` holding the bytes.

The bytes live in their own table rather than a column on `songs` because
`list_songs` serialises every row it selects and a personal tab collection is
hundreds of megabytes. One join away means the only way to load a PDF is to ask
for it.

Revision ID: 005_song_documents
Revises: 004_drop_provider_tables
Create Date: 2026-08-26

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "005_song_documents"
down_revision: str | Sequence[str] | None = "004_drop_provider_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # server_default backfills every existing row as a chart, which is what they
    # all are. It stays on the column afterwards so a raw INSERT that predates
    # this feature still produces a valid row.
    op.add_column(
        "songs",
        sa.Column("kind", sa.String(), nullable=False, server_default="chart"),
    )

    op.create_table(
        "song_files",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("song_id", sa.Integer(), sa.ForeignKey("songs.id"), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    # Unique, not merely indexed: one file per song is the model, and enforcing it
    # here means a double upload cannot leave two sets of bytes where the reader
    # picks one arbitrarily.
    op.create_index("ix_song_files_song_id", "song_files", ["song_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_song_files_song_id", table_name="song_files")
    op.drop_table("song_files")
    op.drop_column("songs", "kind")
