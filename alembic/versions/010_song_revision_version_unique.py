"""one revision per (song_id, version)

Two chat persists for the same song (the background finisher for a disconnected
stream and the user's next request) could both read `current_version`, both add
one, and both insert a revision claiming the same number. The app now bumps the
counter with a single UPDATE ... RETURNING; this makes the database refuse the
duplicate as well.

Rows the race already produced are renumbered rather than deleted: every
revision of an affected song is numbered 1..n in (version, id) order, so each
keeps its content and its place in the history. Songs without a duplicate keep
their numbers. Any song whose counter is then behind its highest revision is
moved up to it, since the next bump would otherwise collide with the constraint.

Downgrade drops the constraint only. The renumbering is not undone: the old
numbers were the bug.

Revision ID: 010_song_revision_version_unique
Revises: 009_drop_songs_folder
Create Date: 2026-10-15

"""

from collections.abc import Sequence

from alembic import op

revision: str = "010_song_revision_version_unique"
down_revision: str | Sequence[str] | None = "009_drop_songs_folder"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        WITH affected AS (
            SELECT DISTINCT song_id
            FROM song_revisions
            GROUP BY song_id, version
            HAVING count(*) > 1
        ),
        renumbered AS (
            SELECT r.id,
                   row_number() OVER (PARTITION BY r.song_id ORDER BY r.version, r.id)
                       AS new_version
            FROM song_revisions r
            JOIN affected a ON a.song_id = r.song_id
        )
        UPDATE song_revisions r
        SET version = renumbered.new_version
        FROM renumbered
        WHERE r.id = renumbered.id AND r.version <> renumbered.new_version
        """
    )
    op.execute(
        """
        UPDATE songs s
        SET current_version = m.max_version
        FROM (
            SELECT song_id, max(version) AS max_version
            FROM song_revisions
            GROUP BY song_id
        ) m
        WHERE m.song_id = s.id AND s.current_version < m.max_version
        """
    )
    op.create_unique_constraint(
        "ux_song_revisions_song_version", "song_revisions", ["song_id", "version"]
    )


def downgrade() -> None:
    op.drop_constraint("ux_song_revisions_song_version", "song_revisions", type_="unique")
