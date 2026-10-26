"""Database initialisation / lightweight migration runner.

SQLite has no Alembic history in this project on purpose (a final-year project
should start with one documented command). ``init_db`` creates all tables and
applies additive column migrations that keep an existing database usable after
a schema change. For PostgreSQL deployments use the Alembic-style baseline in
``docs/DEPLOYMENT.md``.
"""
from __future__ import annotations

import logging

from sqlalchemy import inspect, text

import app.models  # noqa: F401  (registers all tables on Base.metadata)
from app.database.base import Base
from app.database.session import engine

logger = logging.getLogger(__name__)


def _apply_additive_migrations() -> None:
    """Add columns that exist in the model but not in an older SQLite file."""
    inspector = inspect(engine)
    if "damage_reports" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("damage_reports")}
    additions = {
        "location_source": "VARCHAR(24)",
        "ward": "VARCHAR(120)",
        "priority_breakdown": "JSON",
        "is_verified": "BOOLEAN DEFAULT 0 NOT NULL",
        "reporter_label": "VARCHAR(120)",
        "is_synthetic": "BOOLEAN DEFAULT 0 NOT NULL",
    }
    with engine.begin() as conn:
        for name, ddl in additions.items():
            if name not in existing:
                logger.info("migration: adding damage_reports.%s", name)
                conn.execute(text(f"ALTER TABLE damage_reports ADD COLUMN {name} {ddl}"))


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _apply_additive_migrations()


if __name__ == "__main__":  # pragma: no cover
    logging.basicConfig(level=logging.INFO)
    init_db()
    print("database initialised")
