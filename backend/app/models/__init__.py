"""Import all SQLAlchemy ORM models so Base.metadata discovers every table."""

from app.models.event import Event, EventLike, EventParticipant, SoloInterest, SoloStatus
from app.models.group import Group, GroupMember
from app.models.interest import Interest, UserInterest
from app.models.match import Match, UserLike
from app.models.message import Conversation, ConversationParticipant, Message, MessageDeletion
from app.models.report import Report
from app.models.user import Block, User, UserHobby

__all__ = [
    "User",
    "UserHobby",
    "Block",
    "Interest",
    "UserInterest",
    "Event",
    "EventParticipant",
    "EventLike",
    "SoloStatus",
    "SoloInterest",
    "UserLike",
    "Match",
    "Group",
    "GroupMember",
    "Conversation",
    "ConversationParticipant",
    "Message",
    "MessageDeletion",
    "Report",
]
