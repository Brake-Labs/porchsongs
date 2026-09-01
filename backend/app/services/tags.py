"""Reading and writing the tags on a song.

One place, because every caller has to agree about what a tag is: trimmed,
length-capped, compared without regard to case, and never stored twice on the
same song. Spread across the endpoints, "Fiddle Tunes" and "fiddle tunes" become
two tags in one library and nothing tells the user why.
"""

import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Song, SongTag

MAX_TAG_LENGTH = 100

# How many tags one song may carry.
#
# Not a storage limit; a legibility one. Tags render as a row of pills on a song
# card, and a card carrying thirty of them is a card you cannot read the title
# of. High enough that nobody organising a real songbook meets it.
MAX_TAGS_PER_SONG = 20


def normalise(tag: str) -> str:
    """The stored form: trimmed, inner whitespace collapsed, length-capped.

    Case is preserved, because the tag a person typed is the tag they should see.
    Matching folds case separately; see `same_tag`.
    """
    return " ".join(tag.split())[:MAX_TAG_LENGTH]


def same_tag(a: str, b: str) -> bool:
    """Whether two tags are the same tag. Case-insensitive, like artist names."""
    return a.casefold() == b.casefold()


def clean_tags(raw: list[str]) -> list[str]:
    """Normalise a submitted list: drop blanks, fold duplicates, keep the order.

    First spelling wins on a duplicate, so a client sending ["Jam", "jam"] gets
    one tag spelled the way it first appeared rather than an arbitrary one.
    """
    out: list[str] = []
    for value in raw:
        tag = normalise(value)
        if not tag:
            continue
        if any(same_tag(tag, existing) for existing in out):
            continue
        out.append(tag)
    return out[:MAX_TAGS_PER_SONG]


def set_tags(db: Session, song: Song, raw: list[str]) -> None:
    """Replace a song's tags with this list.

    Rows that survive are left alone rather than deleted and reinserted, so ids
    stay stable and the unique constraint is never transiently violated by a
    delete-then-insert that has not flushed yet.
    """
    wanted = clean_tags(raw)
    existing = {row.tag: row for row in song.tag_rows}

    for tag, row in list(existing.items()):
        if not any(same_tag(tag, keep) for keep in wanted):
            song.tag_rows.remove(row)

    have = [row.tag for row in song.tag_rows]
    for tag in wanted:
        if not any(same_tag(tag, current) for current in have):
            song.tag_rows.append(SongTag(tag=tag))


def user_tags(db: Session, user_id: int) -> list[tuple[str, int]]:
    """Every tag this user has, with how many songs carry it, name-sorted.

    Grouped case-insensitively so a library that ended up with both "Jam" and
    "jam" reports one tag rather than two adjacent ones with split counts. The
    spelling reported is the one that sorts first, which is at least stable.
    """
    rows = db.execute(
        select(SongTag.tag, func.count(SongTag.id))
        .join(Song, Song.id == SongTag.song_id)
        .where(Song.user_id == user_id)
        .group_by(SongTag.tag)
    ).all()

    folded: dict[str, tuple[str, int]] = {}
    for tag, count in rows:
        key = tag.casefold()
        if key in folded:
            spelling, running = folded[key]
            folded[key] = (min(spelling, tag), running + count)
        else:
            folded[key] = (tag, count)
    return sorted(folded.values(), key=lambda pair: pair[0].casefold())


# --- Artists -----------------------------------------------------------------
#
# An artist is a column on `songs` rather than a row here, but the matching rule
# is the same one, and the library groups its artist cards by exactly this key.
# Keeping the two in step is why this lives beside `same_tag` rather than in the
# router: three different foldings of a name is how "Neil Young" ends up as two
# cards that the rename endpoint says do not exist.

MAX_ARTIST_LENGTH = 500


# What counts as whitespace, matched to the frontend rather than to Python.
#
# `str.split()` and JavaScript's `\s` very nearly agree, and the two places that
# fold an artist name have to agree exactly or a name groups under one card and
# is missed by the rename that targets that card. The difference that matters is
# U+FEFF, which JS treats as whitespace and Python does not, and which arrives on
# the front of the first field of any file saved with a BOM.
#
# Python also folds U+001C to U+001F and U+0085, which JS does not. Those are
# control characters no artist name contains, and folding more is the safe
# direction: the rename catches a name the library grouped, rather than missing
# one.
_ARTIST_WHITESPACE = re.compile(r"[\s\ufeff]+")


def normalise_artist(artist: str) -> str:
    """The stored form: trimmed, inner whitespace collapsed, length-capped.

    Case is preserved, for the same reason a tag's is: the spelling somebody
    typed is the spelling they should see.
    """
    return " ".join(_ARTIST_WHITESPACE.split(artist.strip()))[:MAX_ARTIST_LENGTH].strip()


def artist_key(artist: str | None) -> str:
    """Case-and-whitespace-insensitive key. Empty for a song with no artist.

    Mirrors `artistKeyOf` in the frontend's `lib/artists.ts`. An empty result is
    the library's "Unknown artist" bucket, which is not an artist and cannot be
    renamed.
    """
    return normalise_artist(artist or "").lower()
