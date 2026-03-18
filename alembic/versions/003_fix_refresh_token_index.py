"""fix redundant unique constraint on refresh_tokens.token

The initial migration created both a column-level UNIQUE constraint (in CREATE
TABLE) and a UNIQUE INDEX (ix_refresh_tokens_token) on refresh_tokens.token.
In PostgreSQL these produce two separate objects. The SQLAlchemy model only
expects the unique index, so drop the redundant column-level constraint.

Revision ID: 003
Revises: 002
Create Date: 2026-03-18

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: str = "002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("refresh_tokens_token_key", "refresh_tokens", type_="unique")


def downgrade() -> None:
    op.create_unique_constraint("refresh_tokens_token_key", "refresh_tokens", ["token"])
