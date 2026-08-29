"""Content-addressed storage for the bytes behind a stored file.

Two operations, and the pairing is the whole design: `put` gives a song a claim on
some bytes, and `prune_orphan_blobs` releases bytes that no song claims any more.

There is deliberately no reference count. A counter is a second copy of a fact the
`song_files` table already holds, and the two can disagree: a crash between the
decrement and the row delete, a bulk delete that skips the ORM, a migration that
moves rows. Asking "does any song still point at this hash" cannot drift, because
it reads the only copy of the answer. It costs one indexed query per delete, which
is nothing next to a delete that already touches revisions and chat messages.
"""

import hashlib

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import SongBlob, SongFile


def put_blob(db: Session, data: bytes) -> tuple[str, int]:
    """Store bytes if they are new, and return their hash and size.

    Flushes so the row is visible to the `song_files` insert that follows in the
    same transaction; the foreign key would otherwise fail against a row the
    session is still holding.
    """
    digest = hashlib.sha256(data).hexdigest()
    size = len(data)

    # Existence, not the content: this is the hot path for re-uploading a file
    # somebody already has, and loading the old bytes to prove they match would
    # undo the saving. The hash is the primary key, so a hit means the bytes are
    # already stored.
    exists = db.execute(select(SongBlob.sha256).where(SongBlob.sha256 == digest)).first()
    if exists is None:
        db.add(SongBlob(sha256=digest, content=data, size_bytes=size))
        db.flush()

    return digest, size


def prune_orphan_blobs(db: Session, hashes: set[str]) -> int:
    """Delete any of `hashes` that no `song_files` row points at. Returns the count.

    Call it after the rows that referenced them are gone and inside the same
    transaction, so a rollback takes the pruning with it. Passing a hash that is
    still referenced is safe and does nothing, which is what makes it callable
    from a delete path that does not know whether the song shared its file.
    """
    if not hashes:
        return 0

    referenced = set(db.scalars(select(SongFile.sha256).where(SongFile.sha256.in_(hashes))).all())
    orphans = hashes - referenced
    if not orphans:
        return 0

    db.query(SongBlob).filter(SongBlob.sha256.in_(orphans)).delete(synchronize_session=False)
    return len(orphans)


def hashes_for_songs(db: Session, song_ids: list[int]) -> set[str]:
    """The blob hashes reachable from these songs, read before the rows go.

    Deleting the `song_files` rows first and then asking what they pointed at
    returns nothing, so every delete path has to collect this while the rows are
    still there.
    """
    if not song_ids:
        return set()
    return set(db.scalars(select(SongFile.sha256).where(SongFile.song_id.in_(song_ids))).all())
