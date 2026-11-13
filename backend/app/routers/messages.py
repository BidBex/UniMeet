from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal, get_db
from app.models.message import Conversation, ConversationParticipant, Message
from app.models.user import User
from app.schemas.social import (
    ConversationDetailOut,
    ConversationOut,
    MessageCreate,
    MessageOut,
    WsTicketOut,
)
from app.security.auth import (
    consume_ws_ticket,
    create_ws_ticket,
    decode_access_token,
    get_current_user,
)
from app.services.serializers import is_blocked_between, user_to_public
from app.services.ws_manager import chat_manager

router = APIRouter(tags=["Messaging"])
settings = get_settings()


def _verify_conversation_access(db: Session, conversation_id: int, user_id: int) -> Conversation:
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")

    participant = (
        db.query(ConversationParticipant)
        .filter(
            ConversationParticipant.conversation_id == conversation_id,
            ConversationParticipant.user_id == user_id,
        )
        .first()
    )
    if not participant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to access this conversation.",
        )

    # For direct 1:1 chats, prevent interaction if either participant blocked the other
    if conv.group_id is None:
        other_cps = (
            db.query(ConversationParticipant)
            .filter(
                ConversationParticipant.conversation_id == conversation_id,
                ConversationParticipant.user_id != user_id,
            )
            .all()
        )
        for other_cp in other_cps:
            if is_blocked_between(db, user_id, other_cp.user_id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Conversation unavailable due to block settings.",
                )

    return conv


def _serialize_conversation(db: Session, conv: Conversation, current_user: User) -> ConversationOut:
    other_user_out = None
    title = conv.title or "Direct Chat"

    if conv.group_id is None:
        other_cp = (
            db.query(ConversationParticipant)
            .filter(
                ConversationParticipant.conversation_id == conv.id,
                ConversationParticipant.user_id != current_user.id,
            )
            .first()
        )
        if other_cp and other_cp.user:
            other_user_out = user_to_public(db, other_cp.user)
            other_name = f"{other_cp.user.first_name} {other_cp.user.last_name}"
            if conv.title and conv.title.startswith("Event: "):
                title = f"{other_name} · {conv.title[7:]}"
            else:
                title = other_name

    last_msg = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .first()
    )
    unread_count = (
        db.query(Message)
        .filter(
            Message.conversation_id == conv.id,
            Message.sender_id != current_user.id,
            Message.is_read.is_(False),
        )
        .count()
    )

    return ConversationOut(
        id=conv.id,
        match_id=conv.match_id,
        group_id=conv.group_id,
        title=title,
        other_user=other_user_out,
        last_message=last_msg.content if last_msg else None,
        last_message_at=last_msg.created_at if last_msg else None,
        unread_count=unread_count,
        created_at=conv.created_at,
    )


@router.post("/messages/ws-ticket", response_model=WsTicketOut, summary="Issue short-lived single-use WS ticket")
def issue_ws_ticket(current_user: User = Depends(get_current_user)):
    ticket = create_ws_ticket(current_user.id, ttl_seconds=30)
    return WsTicketOut(ticket=ticket, expires_in_seconds=30)


@router.get("/messages/conversations", response_model=List[ConversationOut], summary="List user conversations")
def list_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conv_ids = [
        cp.conversation_id
        for cp in db.query(ConversationParticipant)
        .filter(ConversationParticipant.user_id == current_user.id)
        .all()
    ]
    if not conv_ids:
        return []

    convs = db.query(Conversation).filter(Conversation.id.in_(conv_ids)).all()
    items: List[ConversationOut] = []
    for conv in convs:
        if conv.group_id is None:
            other_cp = (
                db.query(ConversationParticipant)
                .filter(
                    ConversationParticipant.conversation_id == conv.id,
                    ConversationParticipant.user_id != current_user.id,
                )
                .first()
            )
            if other_cp and is_blocked_between(db, current_user.id, other_cp.user_id):
                continue
        items.append(_serialize_conversation(db, conv, current_user))

    items.sort(
        key=lambda c: c.last_message_at or c.created_at,
        reverse=True,
    )
    return items


@router.get(
    "/messages/conversations/{conversation_id}",
    response_model=ConversationDetailOut,
    summary="Get conversation details and message history",
)
def get_conversation_detail(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conv = _verify_conversation_access(db, conversation_id, current_user.id)
    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id)
        .order_by(Message.created_at.asc(), Message.id.asc())
        .all()
    )
    return ConversationDetailOut(
        conversation=_serialize_conversation(db, conv, current_user),
        messages=[MessageOut.model_validate(m, from_attributes=True) for m in messages],
    )


@router.post(
    "/messages/conversations/{conversation_id}/messages",
    response_model=MessageOut,
    status_code=status.HTTP_201_CREATED,
    summary="Send and persist a message to a conversation",
)
async def send_message(
    conversation_id: int,
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _verify_conversation_access(db, conversation_id, current_user.id)
    cleaned = payload.content.strip()
    if not cleaned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message content cannot be empty.",
        )

    msg = Message(
        conversation_id=conversation_id,
        sender_id=current_user.id,
        content=cleaned,
        is_read=False,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    out = MessageOut.model_validate(msg, from_attributes=True)
    await chat_manager.broadcast(
        conversation_id,
        {"type": "message:new", "message": out.model_dump(mode="json")},
    )
    return out


@router.put("/messages/{message_id}/read", response_model=MessageOut, summary="Mark a message as read")
def mark_message_read(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    msg = db.query(Message).filter(Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")

    _verify_conversation_access(db, msg.conversation_id, current_user.id)
    msg.is_read = True
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return MessageOut.model_validate(msg, from_attributes=True)


@router.delete("/messages/{message_id}", summary="Delete a message from a conversation")
async def delete_message(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    msg = db.query(Message).filter(Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")

    conv = _verify_conversation_access(db, msg.conversation_id, current_user.id)
    is_direct_chat = conv.group_id is None
    if msg.sender_id != current_user.id and not is_direct_chat and not current_user.is_moderator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own messages in group chats.",
        )

    conv_id = msg.conversation_id
    db.delete(msg)
    db.commit()

    await chat_manager.broadcast(
        conv_id,
        {
            "type": "message:deleted",
            "message_id": message_id,
            "conversation_id": conv_id,
        },
    )
    return {"detail": "Message deleted.", "message_id": message_id, "conversation_id": conv_id}


@router.websocket("/ws/chat/{conversation_id}")
async def websocket_chat(
    websocket: WebSocket,
    conversation_id: int,
    ticket: Optional[str] = Query(default=None),
):
    """
    Real-time WebSocket chat endpoint.
    Authenticates securely via HttpOnly cookie OR single-use short-lived connection ticket
    (never long-lived JWTs in URL query strings).
    """
    user_id: Optional[int] = None
    if ticket:
        user_id = consume_ws_ticket(ticket)
    if user_id is None:
        cookie_token = websocket.cookies.get(settings.COOKIE_NAME)
        if cookie_token:
            user_id = decode_access_token(cookie_token)

    if user_id is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    db_gen = websocket.app.dependency_overrides.get(get_db, get_db)()
    db = next(db_gen)
    try:
        try:
            _verify_conversation_access(db, conversation_id, user_id)
        except HTTPException:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    finally:
        db_gen.close()

    await chat_manager.connect(conversation_id, websocket)
    await websocket.send_json({"type": "connection:ready", "conversation_id": conversation_id})

    try:
        while True:
            data = await websocket.receive_json()
            raw_content = str(data.get("content", "")).strip() if isinstance(data, dict) else ""
            if not raw_content or len(raw_content) > 2000:
                await websocket.send_json(
                    {"type": "error", "detail": "Message content must be 1-2000 characters."}
                )
                continue

            db_gen = websocket.app.dependency_overrides.get(get_db, get_db)()
            db = next(db_gen)
            try:
                try:
                    _verify_conversation_access(db, conversation_id, user_id)
                except HTTPException as exc:
                    await websocket.send_json({"type": "error", "detail": exc.detail})
                    continue

                msg = Message(
                    conversation_id=conversation_id,
                    sender_id=user_id,
                    content=raw_content,
                    is_read=False,
                )
                db.add(msg)
                db.commit()
                db.refresh(msg)
                out = MessageOut.model_validate(msg, from_attributes=True)
            finally:
                db_gen.close()

            await chat_manager.broadcast(
                conversation_id,
                {"type": "message:new", "message": out.model_dump(mode="json")},
            )
    except WebSocketDisconnect:
        chat_manager.disconnect(conversation_id, websocket)
    except Exception:
        chat_manager.disconnect(conversation_id, websocket)
