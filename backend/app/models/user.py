from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    first_name: Mapped[str] = mapped_column(String(80), nullable=False)
    last_name: Mapped[str] = mapped_column(String(80), nullable=False)
    age: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    university: Mapped[Optional[str]] = mapped_column(String(150), nullable=True, index=True)
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    profile_picture: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_moderator: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    demo_key: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    interests = relationship(
        "UserInterest",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    created_events = relationship(
        "Event",
        back_populates="creator",
        cascade="all, delete-orphan",
    )
    event_participations = relationship(
        "EventParticipant",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    event_likes = relationship(
        "EventLike",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    solo_statuses = relationship(
        "SoloStatus",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    group_memberships = relationship(
        "GroupMember",
        back_populates="user",
        cascade="all, delete-orphan",
    )


class Block(Base):
    __tablename__ = "blocks"
    __table_args__ = (
        UniqueConstraint("blocker_id", "blocked_id", name="uq_block_pair"),
        CheckConstraint("blocker_id != blocked_id", name="ck_block_not_self"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    blocker_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    blocked_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    blocker = relationship("User", foreign_keys=[blocker_id])
    blocked = relationship("User", foreign_keys=[blocked_id])
