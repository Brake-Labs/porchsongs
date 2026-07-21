"""drop provider_connections and profile_models (gateway-only LLM)

porchsongs now routes all AI traffic through a single server-side gateway
(any-llm provider "otari" via LLM_API_BASE/LLM_API_KEY). Per-profile provider
connections and saved models are obsolete, so their tables are dropped.

Revision ID: 004_drop_provider_tables
Revises: 296f1aa6481b
Create Date: 2026-07-21

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004_drop_provider_tables"
down_revision: str | Sequence[str] | None = "296f1aa6481b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_profile_models_profile_id", table_name="profile_models")
    op.drop_table("profile_models")
    op.drop_index("ix_provider_connections_profile_id", table_name="provider_connections")
    op.drop_table("provider_connections")


def downgrade() -> None:
    op.create_table(
        "provider_connections",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("profile_id", sa.Integer(), sa.ForeignKey("profiles.id"), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("api_base", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_provider_connections_profile_id", "provider_connections", ["profile_id"])

    op.create_table(
        "profile_models",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("profile_id", sa.Integer(), sa.ForeignKey("profiles.id"), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("api_base", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_profile_models_profile_id", "profile_models", ["profile_id"])
