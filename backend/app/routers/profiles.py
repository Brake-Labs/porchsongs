from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.scoping import get_user_profile
from ..database import get_db
from ..models import Profile, User
from ..schemas import (
    OkResponse,
    ProfileCreate,
    ProfileOut,
    ProfileUpdate,
)

router = APIRouter(tags=["profiles"])


@router.get("/profiles", response_model=list[ProfileOut])
async def list_profiles(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Profile]:
    return (
        db.query(Profile)
        .filter(Profile.user_id == current_user.id)
        .order_by(Profile.created_at.desc())
        .all()
    )


@router.post("/profiles", response_model=ProfileOut, status_code=201)
async def create_profile(
    data: ProfileCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Profile:
    # If this profile is set as default, unset other defaults for this user
    if data.is_default:
        db.query(Profile).filter(
            Profile.user_id == current_user.id, Profile.is_default.is_(True)
        ).update({"is_default": False})

    # If no profiles exist for this user, make this one the default
    if not db.query(Profile).filter(Profile.user_id == current_user.id).first():
        data.is_default = True

    profile = Profile(**data.model_dump(), user_id=current_user.id)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/profiles/{profile_id}", response_model=ProfileOut)
async def get_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Profile:
    return get_user_profile(db, current_user, profile_id)


@router.put("/profiles/{profile_id}", response_model=ProfileOut)
async def update_profile(
    profile_id: int,
    data: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Profile:
    profile = get_user_profile(db, current_user, profile_id)

    update_data = data.model_dump(exclude_unset=True)

    # If setting as default, unset others for this user
    if update_data.get("is_default"):
        db.query(Profile).filter(
            Profile.user_id == current_user.id,
            Profile.is_default.is_(True),
            Profile.id != profile_id,
        ).update({"is_default": False})

    for key, value in update_data.items():
        setattr(profile, key, value)

    profile.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(profile)
    return profile


@router.delete("/profiles/{profile_id}", response_model=OkResponse)
async def delete_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OkResponse:
    from ..models import Song

    profile = get_user_profile(db, current_user, profile_id)

    # Prevent deleting a profile that still has songs
    song_count = db.query(Song).filter(Song.profile_id == profile.id).count()
    if song_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete profile with {song_count} song(s). "
            "Move or delete the songs first.",
        )

    db.delete(profile)
    db.commit()
    return OkResponse(ok=True)
