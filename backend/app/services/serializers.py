from typing import Optional, Set

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.event import Event, EventLike, EventParticipant
from app.models.interest import Interest
from app.models.user import Block, User
from app.schemas.auth import CompatibilityOut, InterestOut, UserPrivateOut, UserPublicOut
from app.schemas.event import EventOut


def get_blocked_user_ids(db: Session, user_id: int) -> Set[int]:
    """Return all user IDs blocked by or blocking `user_id`."""
    rows = (
        db.query(Block)
        .filter(or_(Block.blocker_id == user_id, Block.blocked_id == user_id))
        .all()
    )
    blocked: Set[int] = set()
    for row in rows:
        if row.blocker_id == user_id:
            blocked.add(row.blocked_id)
        else:
            blocked.add(row.blocker_id)
    return blocked


def is_blocked_between(db: Session, user_a_id: int, user_b_id: int) -> bool:
    return (
        db.query(Block)
        .filter(
            or_(
                (Block.blocker_id == user_a_id) & (Block.blocked_id == user_b_id),
                (Block.blocker_id == user_b_id) & (Block.blocked_id == user_a_id),
            )
        )
        .first()
        is not None
    )


def get_user_interests(db: Session, user: User) -> list[InterestOut]:
    rows = (
        db.query(Interest)
        .join(Interest.user_links)
        .filter_by(user_id=user.id)
        .order_by(Interest.category.asc(), Interest.name.asc())
        .all()
    )
    return [InterestOut.model_validate(item) for item in rows]


def user_to_public(
    db: Session,
    user: User,
    compatibility: Optional[CompatibilityOut] = None,
) -> UserPublicOut:
    return UserPublicOut(
        id=user.id,
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
        age=user.age,
        university=user.university,
        city=user.city,
        bio=user.bio,
        profile_picture=user.profile_picture,
        is_verified=user.is_verified,
        interests=get_user_interests(db, user),
        compatibility=compatibility,
    )


def user_to_private(db: Session, user: User) -> UserPrivateOut:
    return UserPrivateOut(
        id=user.id,
        username=user.username,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        age=user.age,
        university=user.university,
        city=user.city,
        bio=user.bio,
        profile_picture=user.profile_picture,
        is_verified=user.is_verified,
        is_active=user.is_active,
        is_moderator=user.is_moderator,
        created_at=user.created_at,
        interests=get_user_interests(db, user),
    )


def event_to_out(db: Session, event: Event, current_user_id: Optional[int] = None) -> EventOut:
    participant_count = (
        db.query(EventParticipant)
        .filter(EventParticipant.event_id == event.id, EventParticipant.status == "going")
        .count()
    )
    like_count = db.query(EventLike).filter(EventLike.event_id == event.id).count()
    is_joined = False
    is_liked = False
    if current_user_id is not None:
        is_joined = (
            db.query(EventParticipant)
            .filter(
                EventParticipant.event_id == event.id,
                EventParticipant.user_id == current_user_id,
            )
            .first()
            is not None
        )
        is_liked = (
            db.query(EventLike)
            .filter(
                EventLike.event_id == event.id,
                EventLike.user_id == current_user_id,
            )
            .first()
            is not None
        )
    creator_name = (
        f"{event.creator.first_name} {event.creator.last_name}" if event.creator else None
    )
    return EventOut(
        id=event.id,
        title=event.title,
        description=event.description,
        category=event.category,
        location=event.location,
        city=event.city,
        university=event.university,
        start_datetime=event.start_datetime,
        end_datetime=event.end_datetime,
        image_url=event.image_url,
        creator_id=event.creator_id,
        creator_name=creator_name,
        max_participants=event.max_participants,
        participant_count=participant_count,
        like_count=like_count,
        is_joined=is_joined,
        is_liked=is_liked,
        created_at=event.created_at,
        is_active=event.is_active,
    )
