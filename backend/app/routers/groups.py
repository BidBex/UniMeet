from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.event import Event
from app.models.group import Group, GroupMember
from app.models.message import Conversation, ConversationParticipant
from app.models.user import User
from app.schemas import MessageResponse
from app.schemas.social import (
    GroupCreate,
    GroupInviteRequest,
    GroupMemberOut,
    GroupOut,
    GroupUpdate,
)
from app.security.auth import get_current_user, get_optional_current_user
from app.services.serializers import get_blocked_user_ids, is_blocked_between, user_to_public

router = APIRouter(prefix="/groups", tags=["Groups"])


def _group_to_out(db: Session, group: Group, current_user: Optional[User]) -> GroupOut:
    active_count = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == group.id, GroupMember.status == "active")
        .count()
    )
    membership = None
    if current_user:
        membership = (
            db.query(GroupMember)
            .filter(GroupMember.group_id == group.id, GroupMember.user_id == current_user.id)
            .first()
        )
    conv = db.query(Conversation).filter(Conversation.group_id == group.id).first()
    return GroupOut(
        id=group.id,
        name=group.name,
        description=group.description,
        creator_id=group.creator_id,
        event_id=group.event_id,
        event_title=group.event.title if group.event else None,
        max_members=group.max_members,
        member_count=active_count,
        is_public=group.is_public,
        university=group.university,
        location=group.location,
        interests_summary=group.interests_summary,
        is_member=membership is not None and membership.status == "active",
        membership_status=membership.status if membership else None,
        conversation_id=conv.id if (conv and membership and membership.status == "active") else None,
        created_at=group.created_at,
    )


def _is_group_admin(db: Session, group: Group, user: User) -> bool:
    if group.creator_id == user.id:
        return True
    member = (
        db.query(GroupMember)
        .filter(
            GroupMember.group_id == group.id,
            GroupMember.user_id == user.id,
            GroupMember.status == "active",
            GroupMember.role == "admin",
        )
        .first()
    )
    return member is not None


@router.get("", response_model=List[GroupOut], summary="Browse public groups and user groups")
def list_groups(
    event_id: Optional[int] = Query(default=None),
    university: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Group)

    if current_user:
        blocked = get_blocked_user_ids(db, current_user.id)
        if blocked:
            query = query.filter(~Group.creator_id.in_(blocked))
        member_group_ids = [
            gm.group_id
            for gm in db.query(GroupMember).filter(GroupMember.user_id == current_user.id).all()
        ]
        if member_group_ids:
            query = query.filter(or_(Group.is_public.is_(True), Group.id.in_(member_group_ids)))
        else:
            query = query.filter(Group.is_public.is_(True))
    else:
        query = query.filter(Group.is_public.is_(True))

    if event_id is not None:
        query = query.filter(Group.event_id == event_id)
    if university:
        query = query.filter(Group.university.ilike(f"%{university.strip()}%"))
    if city:
        query = query.filter(Group.location.ilike(f"%{city.strip()}%"))
    if q:
        term = f"%{q.strip()}%"
        query = query.filter(or_(Group.name.ilike(term), Group.description.ilike(term)))

    groups = query.order_by(Group.created_at.desc()).all()
    return [_group_to_out(db, g, current_user) for g in groups]


@router.post("", response_model=GroupOut, status_code=status.HTTP_201_CREATED, summary="Create a group")
def create_group(
    payload: GroupCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = None
    if payload.event_id is not None:
        event = db.query(Event).filter(Event.id == payload.event_id, Event.is_active.is_(True)).first()
        if not event:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found.")

    group = Group(
        name=payload.name.strip(),
        description=payload.description.strip(),
        creator_id=current_user.id,
        event_id=payload.event_id,
        max_members=payload.max_members,
        is_public=payload.is_public,
        university=(
            payload.university.strip()
            if payload.university
            else (event.university if event else current_user.university)
        ),
        location=(
            payload.location.strip()
            if payload.location
            else (event.city if event else current_user.city)
        ),
        interests_summary=payload.interests_summary.strip() if payload.interests_summary else None,
    )
    db.add(group)
    db.flush()

    db.add(
        GroupMember(
            group_id=group.id,
            user_id=current_user.id,
            role="admin",
            status="active",
        )
    )

    conv = Conversation(group_id=group.id, title=group.name)
    db.add(conv)
    db.flush()
    db.add(ConversationParticipant(conversation_id=conv.id, user_id=current_user.id))

    db.commit()
    db.refresh(group)
    return _group_to_out(db, group, current_user)


@router.get("/{group_id}", response_model=GroupOut, summary="Get group details")
def get_group(
    group_id: int,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")

    if current_user and is_blocked_between(db, current_user.id, group.creator_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")

    if not group.is_public:
        if not current_user:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Private group access denied.")
        membership = (
            db.query(GroupMember)
            .filter(
                GroupMember.group_id == group.id,
                GroupMember.user_id == current_user.id,
                GroupMember.status == "active",
            )
            .first()
        )
        if not membership and group.creator_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Private group access denied.")

    return _group_to_out(db, group, current_user)


@router.put("/{group_id}", response_model=GroupOut, summary="Edit group details")
def update_group(
    group_id: int,
    payload: GroupUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")

    if not _is_group_admin(db, group, current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the group creator or admins can edit this group.",
        )

    updates = payload.model_dump(exclude_unset=True)
    if "max_members" in updates and updates["max_members"] is not None:
        active_count = (
            db.query(GroupMember)
            .filter(GroupMember.group_id == group.id, GroupMember.status == "active")
            .count()
        )
        if updates["max_members"] < active_count:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="max_members cannot be less than current active member count.",
            )

    for field, value in updates.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(group, field, value)

    db.add(group)
    conv = db.query(Conversation).filter(Conversation.group_id == group.id).first()
    if conv:
        conv.title = group.name
        db.add(conv)
    db.commit()
    db.refresh(group)
    return _group_to_out(db, group, current_user)


@router.delete("/{group_id}", response_model=MessageResponse, summary="Delete a group")
def delete_group(
    group_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")

    if group.creator_id != current_user.id and not current_user.is_moderator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the group creator can delete this group.",
        )

    db.query(Conversation).filter(Conversation.group_id == group.id).delete()
    db.delete(group)
    db.commit()
    return MessageResponse(message="Group deleted successfully.")


@router.post("/{group_id}/join", response_model=GroupOut, summary="Join a public group or request private join")
def join_group(
    group_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")

    if is_blocked_between(db, current_user.id, group.creator_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot join group due to block settings.",
        )

    existing = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == group_id, GroupMember.user_id == current_user.id)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already belong to or requested to join this group.",
        )

    active_count = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == group.id, GroupMember.status == "active")
        .count()
    )
    if active_count >= group.max_members:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This group has reached its maximum capacity.",
        )

    member_status = "active" if group.is_public else "pending"
    db.add(
        GroupMember(
            group_id=group.id,
            user_id=current_user.id,
            role="member",
            status=member_status,
        )
    )

    if member_status == "active":
        conv = db.query(Conversation).filter(Conversation.group_id == group.id).first()
        if conv:
            exists_cp = (
                db.query(ConversationParticipant)
                .filter(
                    ConversationParticipant.conversation_id == conv.id,
                    ConversationParticipant.user_id == current_user.id,
                )
                .first()
            )
            if not exists_cp:
                db.add(ConversationParticipant(conversation_id=conv.id, user_id=current_user.id))

    db.commit()
    return _group_to_out(db, group, current_user)


@router.delete("/{group_id}/leave", response_model=GroupOut, summary="Leave a group")
def leave_group(
    group_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")

    membership = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == group_id, GroupMember.user_id == current_user.id)
        .first()
    )
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not a member of this group.",
        )

    db.delete(membership)
    conv = db.query(Conversation).filter(Conversation.group_id == group.id).first()
    if conv:
        db.query(ConversationParticipant).filter(
            ConversationParticipant.conversation_id == conv.id,
            ConversationParticipant.user_id == current_user.id,
        ).delete()

    db.commit()
    return _group_to_out(db, group, current_user)


@router.get("/{group_id}/members", response_model=List[GroupMemberOut], summary="List group members")
def list_group_members(
    group_id: int,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")

    if not group.is_public:
        if not current_user:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Private group access denied.")
        membership = (
            db.query(GroupMember)
            .filter(
                GroupMember.group_id == group_id,
                GroupMember.user_id == current_user.id,
                GroupMember.status == "active",
            )
            .first()
        )
        if not membership and group.creator_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Private group access denied.")

    blocked = get_blocked_user_ids(db, current_user.id) if current_user else set()
    is_admin = current_user is not None and _is_group_admin(db, group, current_user)

    query = db.query(GroupMember).filter(GroupMember.group_id == group_id)
    if not is_admin:
        query = query.filter(GroupMember.status == "active")

    rows = query.order_by(GroupMember.joined_at.asc()).all()
    return [
        GroupMemberOut(
            id=row.id,
            user_id=row.user_id,
            role=row.role,
            status=row.status,
            joined_at=row.joined_at,
            user=user_to_public(db, row.user),
        )
        for row in rows
        if row.user_id not in blocked
    ]


@router.post("/{group_id}/members/{user_id}/approve", response_model=GroupMemberOut, summary="Approve private group request")
def approve_group_member(
    group_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")
    if not _is_group_admin(db, group, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")

    membership = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership request not found.")

    active_count = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == group_id, GroupMember.status == "active")
        .count()
    )
    if membership.status != "active" and active_count >= group.max_members:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Group is at capacity.")

    membership.status = "active"
    db.add(membership)

    conv = db.query(Conversation).filter(Conversation.group_id == group.id).first()
    if conv:
        exists_cp = (
            db.query(ConversationParticipant)
            .filter(
                ConversationParticipant.conversation_id == conv.id,
                ConversationParticipant.user_id == user_id,
            )
            .first()
        )
        if not exists_cp:
            db.add(ConversationParticipant(conversation_id=conv.id, user_id=user_id))

    db.commit()
    db.refresh(membership)
    return GroupMemberOut(
        id=membership.id,
        user_id=membership.user_id,
        role=membership.role,
        status=membership.status,
        joined_at=membership.joined_at,
        user=user_to_public(db, membership.user),
    )


@router.post("/{group_id}/invite", response_model=GroupMemberOut, summary="Invite a user into a group")
def invite_to_group(
    group_id: int,
    payload: GroupInviteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found.")
    if not _is_group_admin(db, group, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only group admins can invite.")

    target = db.query(User).filter(User.id == payload.user_id, User.is_active.is_(True)).first()
    if not target or is_blocked_between(db, current_user.id, payload.user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    existing = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == group_id, GroupMember.user_id == payload.user_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already in group.")

    active_count = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == group_id, GroupMember.status == "active")
        .count()
    )
    if active_count >= group.max_members:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Group is at capacity.")

    member = GroupMember(group_id=group.id, user_id=target.id, role="member", status="active")
    db.add(member)

    conv = db.query(Conversation).filter(Conversation.group_id == group.id).first()
    if conv:
        db.add(ConversationParticipant(conversation_id=conv.id, user_id=target.id))

    db.commit()
    db.refresh(member)
    return GroupMemberOut(
        id=member.id,
        user_id=member.user_id,
        role=member.role,
        status=member.status,
        joined_at=member.joined_at,
        user=user_to_public(db, target),
    )
