from datetime import UTC, datetime

from fastapi import Depends, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Profile, User

LOCAL_EMAIL = "local@porchsongs.local"


def _get_or_create_local_user(db: Session) -> User:
    """Return the single local user, creating it on first access."""
    user = db.query(User).filter(User.email == LOCAL_EMAIL).first()
    if user:
        return user
    user = User(
        email=LOCAL_EMAIL,
        name="Local User",
        role="admin",
        is_active=True,
        created_at=datetime.now(UTC),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        user = db.query(User).filter(User.email == LOCAL_EMAIL).first()
        if user:
            return user
        raise
    db.refresh(user)
    # Create a default profile for the new user
    profile = Profile(
        user_id=user.id,
        is_default=True,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(profile)
    db.commit()
    return user


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    """Return the user for this request.

    In OSS mode there is no authentication: every request is served by the
    single local user. An app built with ``create_app(plugin)`` resolves the
    user with the plugin's ``authenticator()`` instead.
    """
    authenticate = getattr(request.app.state, "authenticate", None)
    if authenticate is not None:
        return authenticate(request, db)
    return _get_or_create_local_user(db)
