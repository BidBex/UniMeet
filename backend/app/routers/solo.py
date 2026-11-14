from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.event import Event, SoloInterest, SoloStatus
from app.models.message import Conversation, ConversationParticipant, Message
from app.models.user import User
from app.schemas import MessageResponse
from app.schemas.social import SoloCreate, SoloInterestRequest, SoloInterestResponse, SoloOut
from app.security.auth import get_current_user, get_optional_current_user
from app.services.compatibility import compute_compatibility
from app.services.serializers import get_blocked_user_ids, is_blocked_between, user_to_public

router = APIRouter(prefix="/solo", tags=["Going Solo"])


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_naive_or_aware_cmp(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _solo_to_out(db: Session, solo: SoloStatus, current_user: Optional[User]) -> SoloOut:
    interest_count = db.query(SoloInterest).filter(SoloInterest.solo_id == solo.id).count()
    has_expressed = False
    compat = None
    if current_user:
        has_expressed = (
            db.query(SoloInterest)
            .filter(SoloInterest.solo_id == solo.id, SoloInterest.user_id == current_user.id)
            .first()
            is not None
        )
        if current_user.id != solo.user_id:
            compat = compute_compatibility(db, current_user, solo.user)

    return SoloOut(
        id=solo.id,
        user_id=solo.user_id,
        event_id=solo.event_id,
        message=solo.message,
        status=solo.status,
        created_at=solo.created_at,
        expires_at=solo.expires_at,
        user=user_to_public(db, solo.user, compatibility=compat),
        event_title=solo.event.title,
        event_city=solo.event.city,
        event_start_datetime=solo.event.start_datetime,
        interest_count=interest_count,
        has_expressed_interest=has_expressed,
    )


@router.post("", response_model=SoloOut, status_code=status.HTTP_201_CREATED, summary="Announce Going Solo status")
def create_solo_status(
    payload: SoloCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(Event).filter(Event.id == payload.event_id, Event.is_active.is_(True)).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

    now = _utc_now()
    existing_active = (
        db.query(SoloStatus)
        .filter(
            SoloStatus.user_id == current_user.id,
            SoloStatus.event_id == payload.event_id,
            SoloStatus.status == "active",
            SoloStatus.expires_at > now,
        )
        .first()
    )
    if existing_active:
        existing_active.message = payload.message.strip()
        existing_active.expires_at = now + timedelta(hours=payload.expires_hours)
        db.add(existing_active)
        db.commit()
        db.refresh(existing_active)
        return _solo_to_out(db, existing_active, current_user)

    solo = SoloStatus(
        user_id=current_user.id,
        event_id=payload.event_id,
        message=payload.message.strip(),
        status="active",
        expires_at=now + timedelta(hours=payload.expires_hours),
    )
    db.add(solo)
    db.commit()
    db.refresh(solo)
    return _solo_to_out(db, solo, current_user)


@router.get("", response_model=List[SoloOut], summary="Browse active, non-expired Going Solo announcements")
def list_solo_statuses(
    event_id: Optional[int] = Query(default=None),
    university: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    now = _utc_now()
    query = (
        db.query(SoloStatus)
        .join(Event, SoloStatus.event_id == Event.id)
        .join(User, SoloStatus.user_id == User.id)
        .filter(
            SoloStatus.status == "active",
            SoloStatus.expires_at > now,
            Event.is_active.is_(True),
            User.is_active.is_(True),
        )
    )

    if current_user:
        blocked = get_blocked_user_ids(db, current_user.id)
        if blocked:
            query = query.filter(~SoloStatus.user_id.in_(blocked))

    if event_id is not None:
        query = query.filter(SoloStatus.event_id == event_id)
    if university:
        query = query.filter(User.university.ilike(f"%{university.strip()}%"))
    if city:
        query = query.filter(Event.city.ilike(f"%{city.strip()}%"))

    rows = query.order_by(SoloStatus.created_at.desc()).all()
    return [_solo_to_out(db, row, current_user) for row in rows]


@router.get("/{solo_id}", response_model=SoloOut, summary="Get Going Solo announcement details")
def get_solo_status(
    solo_id: int,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    solo = db.query(SoloStatus).filter(SoloStatus.id == solo_id, SoloStatus.status == "active").first()
    if not solo or _ensure_naive_or_aware_cmp(solo.expires_at) <= _utc_now():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Solo status not found or expired.")
    if current_user and is_blocked_between(db, current_user.id, solo.user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Solo status not found.")
    return _solo_to_out(db, solo, current_user)


@router.delete("/{solo_id}", response_model=MessageResponse, summary="Deactivate own Going Solo status")
def deactivate_solo_status(
    solo_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    solo = db.query(SoloStatus).filter(SoloStatus.id == solo_id).first()
    if not solo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Solo status not found.")
    if solo.user_id != current_user.id and not current_user.is_moderator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the creator can deactivate this Going Solo status.",
        )

    solo.status = "inactive"
    db.add(solo)
    db.commit()
    return MessageResponse(message="Going Solo status deactivated.")


@router.post("/{solo_id}/interest", response_model=SoloInterestResponse, summary="Express interest in joining a solo attendee")
def express_solo_interest(
    solo_id: int,
    payload: SoloInterestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    solo = db.query(SoloStatus).filter(SoloStatus.id == solo_id, SoloStatus.status == "active").first()
    if not solo or _ensure_naive_or_aware_cmp(solo.expires_at) <= _utc_now():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Solo status not found or expired.")

    if solo.user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot express interest in your own Going Solo post.",
        )

    if is_blocked_between(db, current_user.id, solo.user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Interaction unavailable due to block settings.",
        )

    existing = (
        db.query(SoloInterest)
        .filter(SoloInterest.solo_id == solo.id, SoloInterest.user_id == current_user.id)
        .first()
    )
    if not existing:
        db.add(
            SoloInterest(
                solo_id=solo.id,
                user_id=current_user.id,
                message=payload.message.strip() if payload.message else None,
            )
        )

    # Find or create a direct conversation so they can arrange attending together
    my_conv_ids = {
        cp.conversation_id
        for cp in db.query(ConversationParticipant)
        .filter(ConversationParticipant.user_id == current_user.id)
        .all()
    }
    conv = None
    if my_conv_ids:
        conv = (
            db.query(Conversation)
            .join(ConversationParticipant, ConversationParticipant.conversation_id == Conversation.id)
            .filter(
                Conversation.id.in_(my_conv_ids),
                Conversation.group_id.is_(None),
                ConversationParticipant.user_id == solo.user_id,
            )
            .first()
        )
    if not conv:
        conv = Conversation(title=f"Solo: {solo.event.title}")
        db.add(conv)
        db.flush()
        db.add(ConversationParticipant(conversation_id=conv.id, user_id=current_user.id))
        db.add(ConversationParticipant(conversation_id=conv.id, user_id=solo.user_id))
        db.flush()

    intro = (
        payload.message.strip()
        if payload.message and payload.message.strip()
        else f"Hey! I'm also interested in going to {solo.event.title} — want to team up?"
    )
    if not existing:
        db.add(Message(conversation_id=conv.id, sender_id=current_user.id, content=intro))

    db.commit()
    return SoloInterestResponse(
        solo_id=solo.id,
        conversation_id=conv.id,
        message="Interest recorded and conversation opened.",
    )
