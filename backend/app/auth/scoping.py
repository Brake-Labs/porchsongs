from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import Profile, Song, User


def get_user_profile(db: Session, user: User, profile_id: int) -> Profile:
    """Fetch a profile that belongs to the given user, or raise 404."""
    profile = db.query(Profile).filter(Profile.id == profile_id, Profile.user_id == user.id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile


def get_user_song(db: Session, user: User, song_id: int) -> Song:
    """Fetch a song by integer ID that belongs to the given user, or raise 404."""
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


def get_user_song_by_uuid(db: Session, user: User, song_uuid: str) -> Song:
    """Fetch a song by UUID that belongs to the given user, or raise 404."""
    song = db.query(Song).filter(Song.uuid == song_uuid, Song.user_id == user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


def reject_documents(song: Song, action: str) -> None:
    """Guard the text-only routes.

    A document has no chart text to revise, summarise, or discuss, so these are
    404-shaped rather than 400-shaped situations: the resource genuinely is not
    there. 409 says the song exists and this is not a thing it does, which is the
    accurate answer and the one the frontend can show.
    """
    if song.kind == "document":
        raise HTTPException(status_code=409, detail=f"A stored document cannot be {action}.")
