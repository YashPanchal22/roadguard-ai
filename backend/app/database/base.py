"""Declarative base and shared column helpers."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, TypeDecorator
from sqlalchemy.orm import DeclarativeBase


def utcnow() -> datetime:
    """Timezone-aware UTC now (stored naive-UTC for SQLite portability)."""
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """Store naive UTC, always return timezone-aware UTC.

    SQLite has no native tz support; this keeps behaviour identical when the
    project is pointed at PostgreSQL later (TIMESTAMP WITH TIME ZONE).
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc)


class Base(DeclarativeBase):
    pass
