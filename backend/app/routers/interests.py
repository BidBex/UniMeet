from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.interest import Interest
from app.schemas.auth import InterestOut

router = APIRouter(prefix="/interests", tags=["Interests"])


@router.get("", response_model=List[InterestOut], summary="List all available interests")
def list_interests(db: Session = Depends(get_db)):
    rows = db.query(Interest).order_by(Interest.category.asc(), Interest.name.asc()).all()
    return [InterestOut.model_validate(item) for item in rows]
