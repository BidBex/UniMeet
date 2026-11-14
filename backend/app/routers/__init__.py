"""API routers package."""

from app.routers import (
    auth,
    community,
    events,
    groups,
    interests,
    matches,
    messages,
    safety,
    solo,
    users,
)

__all__ = [
    "auth",
    "users",
    "events",
    "interests",
    "matches",
    "groups",
    "solo",
    "messages",
    "community",
    "safety",
]
