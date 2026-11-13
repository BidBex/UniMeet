from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Interest(Base):
    __tablename__ = "interests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(80), nullable=False, index=True)

    user_links = relationship(
        "UserInterest",
        back_populates="interest",
        cascade="all, delete-orphan",
    )


class UserInterest(Base):
    __tablename__ = "user_interests"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    interest_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("interests.id", ondelete="CASCADE"), primary_key=True
    )

    user = relationship("User", back_populates="interests")
    interest = relationship("Interest", back_populates="user_links")
