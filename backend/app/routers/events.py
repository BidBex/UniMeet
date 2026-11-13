from datetime import datetime, timezone
import math
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.event import Event, EventLike, EventParticipant
from app.models.message import Conversation, ConversationParticipant, Message
from app.models.user import User
from app.schemas import MessageResponse
from app.schemas.event import EventCreate, EventListOut, EventOut, EventUpdate, ParticipantOut
from app.security.auth import get_current_user, get_optional_current_user
from app.services.serializers import event_to_out, get_blocked_user_ids, is_blocked_between, user_to_public

router = APIRouter(prefix="/events", tags=["Events"])


def _find_or_create_event_conversation(
    db: Session,
    user1_id: int,
    user2_id: int,
    event_title: str,
) -> Conversation:
    title_key = f"Event: {event_title}"[:150]
    u1_convs = {
        cp.conversation_id
        for cp in db.query(ConversationParticipant)
        .filter(ConversationParticipant.user_id == user1_id)
        .all()
    }
    if u1_convs:
        existing = (
            db.query(Conversation)
            .join(ConversationParticipant, ConversationParticipant.conversation_id == Conversation.id)
            .filter(
                Conversation.id.in_(u1_convs),
                Conversation.group_id.is_(None),
                Conversation.title == title_key,
                ConversationParticipant.user_id == user2_id,
            )
            .first()
        )
        if existing:
            return existing

    conv = Conversation(title=title_key)
    db.add(conv)
    db.flush()
    db.add(ConversationParticipant(conversation_id=conv.id, user_id=user1_id))
    db.add(ConversationParticipant(conversation_id=conv.id, user_id=user2_id))
    db.flush()
    return conv


@router.get("", response_model=EventListOut, summary="List and filter events with pagination")
def list_events(
    q: Optional[str] = Query(default=None, description="Search by event title"),
    category: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    university: Optional[str] = Query(default=None),
    date: Optional[str] = Query(default=None, description="ISO date YYYY-MM-DD"),
    date_from: Optional[datetime] = Query(default=None),
    date_to: Optional[datetime] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=12, ge=1, le=50),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Event).filter(Event.is_active.is_(True))

    if current_user is not None:
        blocked = get_blocked_user_ids(db, current_user.id)
        if blocked:
            query = query.filter(~Event.creator_id.in_(blocked))

    if q:
        term = f"%{q.strip()}%"
        query = query.filter(Event.title.ilike(term))
    if category:
        query = query.filter(Event.category.ilike(category.strip()))
    if city:
        query = query.filter(Event.city.ilike(f"%{city.strip()}%"))
    if university:
        query = query.filter(Event.university.ilike(f"%{university.strip()}%"))
    if date:
        try:
            target = datetime.fromisoformat(date).date()
            start_day = datetime(target.year, target.month, target.day, 0, 0, 0, tzinfo=timezone.utc)
            end_day = datetime(target.year, target.month, target.day, 23, 59, 59, tzinfo=timezone.utc)
            query = query.filter(Event.start_datetime >= start_day, Event.start_datetime <= end_day)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date format. Use YYYY-MM-DD.",
            )
    if date_from:
        query = query.filter(Event.start_datetime >= date_from)
    if date_to:
        query = query.filter(Event.start_datetime <= date_to)

    total = query.count()
    pages = max(1, math.ceil(total / limit))
    items = (
        query.order_by(Event.start_datetime.asc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    uid = current_user.id if current_user else None
    return EventListOut(
        items=[event_to_out(db, ev, current_user_id=uid) for ev in items],
        total=total,
        page=page,
        limit=limit,
        pages=pages,
    )


@router.get("/{event_id}", response_model=EventOut, summary="Get event details")
def get_event(
    event_id: int,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(Event).filter(Event.id == event_id, Event.is_active.is_(True)).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")
    uid = current_user.id if current_user else None
    return event_to_out(db, event, current_user_id=uid)


@router.post(
    "",
    response_model=EventOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new event",
)
def create_event(
    payload: EventCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.end_datetime and payload.end_datetime < payload.start_datetime:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="End datetime cannot be earlier than start datetime.",
        )

    event = Event(
        title=payload.title.strip(),
        description=payload.description.strip(),
        category=payload.category.strip(),
        location=payload.location.strip(),
        city=payload.city.strip(),
        university=payload.university.strip() if payload.university else None,
        start_datetime=payload.start_datetime,
        end_datetime=payload.end_datetime,
        image_url=payload.image_url.strip() if payload.image_url else None,
        creator_id=current_user.id,
        max_participants=payload.max_participants,
        is_active=True,
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    # Creator automatically joins their own outing
    db.add(EventParticipant(event_id=event.id, user_id=current_user.id, status="going"))

    # Generate realistic student inquiry messages related to the new event
    blocked_ids = get_blocked_user_ids(db, current_user.id)
    excluded_ids = blocked_ids | {current_user.id}
    candidates = (
        db.query(User)
        .filter(User.is_active.is_(True), ~User.id.in_(excluded_ids))
        .all()
    )
    if candidates:
        candidates.sort(
            key=lambda u: (
                (u.city or "").lower() == event.city.lower(),
                bool(event.university and u.university and u.university.lower() == event.university.lower()),
                u.id,
            ),
            reverse=True,
        )
        prompts = [
            f'Hey {current_user.first_name}! Just saw your new {event.category.lower()} outing "{event.title}" in {event.city}. What time should we meet at {event.location}?',
            f'Hi {current_user.first_name}! "{event.title}" sounds awesome — are spots still open if I bring a classmate from campus?',
        ]
        for peer, msg_text in zip(candidates[:2], prompts):
            conv = _find_or_create_event_conversation(db, current_user.id, peer.id, event.title)
            db.add(
                Message(
                    conversation_id=conv.id,
                    sender_id=peer.id,
                    content=msg_text,
                    is_read=False,
                )
            )

    db.commit()

    return event_to_out(db, event, current_user_id=current_user.id)


@router.put("/{event_id}", response_model=EventOut, summary="Update an owned event")
def update_event(
    event_id: int,
    payload: EventUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(Event).filter(Event.id == event_id, Event.is_active.is_(True)).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")
    if event.creator_id != current_user.id and not current_user.is_moderator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the event creator can modify this event.",
        )

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(event, field, value)

    if event.end_datetime and event.end_datetime < event.start_datetime:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="End datetime cannot be earlier than start datetime.",
        )

    db.add(event)
    db.commit()
    db.refresh(event)
    return event_to_out(db, event, current_user_id=current_user.id)


@router.delete("/{event_id}", response_model=MessageResponse, summary="Delete an owned event")
def delete_event(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(Event).filter(Event.id == event_id, Event.is_active.is_(True)).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")
    if event.creator_id != current_user.id and not current_user.is_moderator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the event creator can delete this event.",
        )

    db.delete(event)
    db.commit()
    return MessageResponse(message="Event deleted successfully.")


@router.post("/{event_id}/join", response_model=EventOut, summary="Join an event")
def join_event(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(Event).filter(Event.id == event_id, Event.is_active.is_(True)).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

    existing = (
        db.query(EventParticipant)
        .filter(
            EventParticipant.event_id == event_id,
            EventParticipant.user_id == current_user.id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already joined this event.",
        )

    if event.max_participants is not None:
        current_count = (
            db.query(EventParticipant)
            .filter(EventParticipant.event_id == event_id, EventParticipant.status == "going")
            .count()
        )
        if current_count >= event.max_participants:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This event has reached its maximum participant capacity.",
            )

    db.add(EventParticipant(event_id=event_id, user_id=current_user.id, status="going"))
    db.commit()
    return event_to_out(db, event, current_user_id=current_user.id)


@router.delete("/{event_id}/leave", response_model=EventOut, summary="Leave an event")
def leave_event(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(Event).filter(Event.id == event_id, Event.is_active.is_(True)).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

    participant = (
        db.query(EventParticipant)
        .filter(
            EventParticipant.event_id == event_id,
            EventParticipant.user_id == current_user.id,
        )
        .first()
    )
    if not participant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not participating in this event.",
        )

    db.delete(participant)
    db.commit()
    return event_to_out(db, event, current_user_id=current_user.id)


@router.post("/{event_id}/like", response_model=EventOut, summary="Like an event")
def like_event(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(Event).filter(Event.id == event_id, Event.is_active.is_(True)).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

    existing = (
        db.query(EventLike)
        .filter(EventLike.event_id == event_id, EventLike.user_id == current_user.id)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already liked this event.",
        )

    db.add(EventLike(event_id=event_id, user_id=current_user.id))

    if event.creator_id != current_user.id and not is_blocked_between(db, current_user.id, event.creator_id):
        conv = _find_or_create_event_conversation(db, current_user.id, event.creator_id, event.title)
        db.add(
            Message(
                conversation_id=conv.id,
                sender_id=event.creator_id,
                content=(
                    f'Hey {current_user.first_name}! Thanks for liking "{event.title}" in {event.city}. '
                    f'Want to meet up near {event.location} before it starts?'
                ),
                is_read=False,
            )
        )

    db.commit()
    return event_to_out(db, event, current_user_id=current_user.id)


@router.delete("/{event_id}/like", response_model=EventOut, summary="Remove event like")
def unlike_event(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(Event).filter(Event.id == event_id, Event.is_active.is_(True)).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

    existing = (
        db.query(EventLike)
        .filter(EventLike.event_id == event_id, EventLike.user_id == current_user.id)
        .first()
    )
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You have not liked this event.",
        )

    db.delete(existing)
    db.commit()
    return event_to_out(db, event, current_user_id=current_user.id)


@router.get("/{event_id}/participants", response_model=List[ParticipantOut], summary="List event participants")
def list_event_participants(
    event_id: int,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(Event).filter(Event.id == event_id, Event.is_active.is_(True)).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

    blocked = get_blocked_user_ids(db, current_user.id) if current_user else set()
    rows = (
        db.query(EventParticipant)
        .filter(EventParticipant.event_id == event_id)
        .order_by(EventParticipant.joined_at.asc())
        .all()
    )

    result = []
    for row in rows:
        if row.user_id in blocked:
            continue
        result.append(
            ParticipantOut(
                id=row.id,
                user_id=row.user_id,
                status=row.status,
                joined_at=row.joined_at,
                user=user_to_public(db, row.user),
            )
        )
    return result
