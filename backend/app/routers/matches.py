from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.event import Event
from app.models.match import Match, UserLike
from app.models.message import Conversation, ConversationParticipant
from app.models.user import User
from app.schemas import MessageResponse
from app.schemas.social import LikeResponse, MatchOut, UserLikeRequest
from app.security.auth import get_current_user
from app.services.compatibility import compute_compatibility
from app.services.serializers import get_blocked_user_ids, is_blocked_between, user_to_public

router = APIRouter(prefix="/matches", tags=["Matching"])


def _find_or_create_match_conversation(
    db: Session,
    match: Match,
    user1_id: int,
    user2_id: int,
) -> Conversation:
    conv = db.query(Conversation).filter(Conversation.match_id == match.id).first()
    if conv:
        return conv

    # Reuse existing direct conversation between these two users if one exists
    user1_convs = {
        cp.conversation_id
        for cp in db.query(ConversationParticipant)
        .filter(ConversationParticipant.user_id == user1_id)
        .all()
    }
    if user1_convs:
        shared = (
            db.query(Conversation)
            .join(ConversationParticipant, ConversationParticipant.conversation_id == Conversation.id)
            .filter(
                Conversation.id.in_(user1_convs),
                Conversation.group_id.is_(None),
                ConversationParticipant.user_id == user2_id,
            )
            .first()
        )
        if shared:
            if shared.match_id is None:
                shared.match_id = match.id
                db.add(shared)
                db.commit()
                db.refresh(shared)
            return shared

    conv = Conversation(match_id=match.id, title=None)
    db.add(conv)
    db.flush()
    db.add(ConversationParticipant(conversation_id=conv.id, user_id=user1_id))
    db.add(ConversationParticipant(conversation_id=conv.id, user_id=user2_id))
    db.commit()
    db.refresh(conv)
    return conv


def _serialize_match(db: Session, match: Match, current_user: User) -> MatchOut:
    other_user = match.user2 if match.user1_id == current_user.id else match.user1
    compat = compute_compatibility(db, current_user, other_user)
    conv = db.query(Conversation).filter(Conversation.match_id == match.id).first()
    return MatchOut(
        id=match.id,
        user1_id=match.user1_id,
        user2_id=match.user2_id,
        event_id=match.event_id,
        event_title=match.event.title if match.event else "Event",
        other_user=user_to_public(db, other_user, compatibility=compat),
        conversation_id=conv.id if conv else None,
        status=match.status,
        created_at=match.created_at,
    )


@router.post("/like", response_model=LikeResponse, summary="Like a user for an event")
def like_user_for_event(
    payload: UserLikeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.receiver_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot like yourself.",
        )

    receiver = (
        db.query(User)
        .filter(User.id == payload.receiver_id, User.is_active.is_(True))
        .first()
    )
    if not receiver:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found.")

    if is_blocked_between(db, current_user.id, receiver.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Interaction unavailable due to block settings.",
        )

    event = (
        db.query(Event)
        .filter(Event.id == payload.event_id, Event.is_active.is_(True))
        .first()
    )
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

    existing_like = (
        db.query(UserLike)
        .filter(
            UserLike.sender_id == current_user.id,
            UserLike.receiver_id == receiver.id,
            UserLike.event_id == event.id,
        )
        .first()
    )
    if existing_like:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already liked this user for this event.",
        )

    like = UserLike(
        sender_id=current_user.id,
        receiver_id=receiver.id,
        event_id=event.id,
    )
    db.add(like)
    db.commit()

    reciprocal = (
        db.query(UserLike)
        .filter(
            UserLike.sender_id == receiver.id,
            UserLike.receiver_id == current_user.id,
            UserLike.event_id == event.id,
        )
        .first()
    )

    if not reciprocal:
        return LikeResponse(liked=True, is_match=False, match=None)

    u1, u2 = sorted([current_user.id, receiver.id])
    match = (
        db.query(Match)
        .filter(
            Match.user1_id == u1,
            Match.user2_id == u2,
            Match.event_id == event.id,
        )
        .first()
    )
    if not match:
        match = Match(
            user1_id=u1,
            user2_id=u2,
            event_id=event.id,
            status="active",
        )
        db.add(match)
        db.commit()
        db.refresh(match)
    elif match.status != "active":
        match.status = "active"
        db.add(match)
        db.commit()
        db.refresh(match)

    _find_or_create_match_conversation(db, match, u1, u2)
    return LikeResponse(
        liked=True,
        is_match=True,
        match=_serialize_match(db, match, current_user),
    )


@router.get("", response_model=List[MatchOut], summary="List current user's active matches")
def list_matches(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    blocked = get_blocked_user_ids(db, current_user.id)
    matches = (
        db.query(Match)
        .filter(
            Match.status == "active",
            or_(Match.user1_id == current_user.id, Match.user2_id == current_user.id),
        )
        .order_by(Match.created_at.desc())
        .all()
    )

    results: List[MatchOut] = []
    for match in matches:
        other_id = match.user2_id if match.user1_id == current_user.id else match.user1_id
        if other_id in blocked:
            continue
        results.append(_serialize_match(db, match, current_user))
    return results


@router.get("/{match_id}", response_model=MatchOut, summary="Get match details")
def get_match(
    match_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    match = (
        db.query(Match)
        .filter(
            Match.id == match_id,
            Match.status == "active",
            or_(Match.user1_id == current_user.id, Match.user2_id == current_user.id),
        )
        .first()
    )
    if not match:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found.")

    other_id = match.user2_id if match.user1_id == current_user.id else match.user1_id
    if is_blocked_between(db, current_user.id, other_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found.")

    return _serialize_match(db, match, current_user)


@router.delete("/{match_id}", response_model=MessageResponse, summary="Unmatch / delete a match")
def delete_match(
    match_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    match = (
        db.query(Match)
        .filter(
            Match.id == match_id,
            or_(Match.user1_id == current_user.id, Match.user2_id == current_user.id),
        )
        .first()
    )
    if not match:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found.")

    # Remove reciprocal likes for that event so re-liking isn't permanently stuck or auto-matched
    other_id = match.user2_id if match.user1_id == current_user.id else match.user1_id
    db.query(UserLike).filter(
        UserLike.event_id == match.event_id,
        or_(
            and_(UserLike.sender_id == current_user.id, UserLike.receiver_id == other_id),
            and_(UserLike.sender_id == other_id, UserLike.receiver_id == current_user.id),
        ),
    ).delete(synchronize_session=False)

    db.delete(match)
    db.commit()
    return MessageResponse(message="Match removed successfully.")
