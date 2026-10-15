"""The LLM routes' wire contract: SSE frames, error shapes, and the gateway check.

Premium's guard parses the SSE ``done`` frame for usage, and the frontend parses
every frame, so the stream bodies here are pinned byte for byte.
"""

import asyncio
import json
from collections.abc import AsyncIterator, Generator
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from any_llm import RateLimitError
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import ChatMessage as ChatMessageModel
from app.models import User
from app.routers import rewrite
from app.schemas import ChatRequest

MODEL = {"model": "gpt-4o-mini"}


def _events(
    text_chunks: list[str],
    thinking_chunks: list[str] | None = None,
    *,
    usage_first: bool = False,
) -> list[SimpleNamespace]:
    start = SimpleNamespace(
        type="message_start",
        message=SimpleNamespace(
            usage=SimpleNamespace(
                input_tokens=10, cache_creation_input_tokens=None, cache_read_input_tokens=None
            )
        ),
        delta=None,
        usage=None,
    )
    deltas = [
        SimpleNamespace(
            type="content_block_delta",
            delta=SimpleNamespace(type="thinking_delta", thinking=t),
            message=None,
            usage=None,
        )
        for t in thinking_chunks or []
    ] + [
        SimpleNamespace(
            type="content_block_delta",
            delta=SimpleNamespace(type="text_delta", text=t),
            message=None,
            usage=None,
        )
        for t in text_chunks
    ]
    usage = SimpleNamespace(
        type="message_delta", usage=SimpleNamespace(output_tokens=20), message=None, delta=None
    )
    return [start, usage, *deltas] if usage_first else [start, *deltas, usage]


async def _aiter(items: list[Any]) -> AsyncIterator[Any]:
    for item in items:
        yield item


def _song(client: TestClient) -> dict[str, Any]:
    profile = client.post("/api/profiles", json={"name": "Test"}).json()
    return client.post(
        "/api/songs",
        json={
            "profile_id": profile["id"],
            "title": "T",
            "artist": "A",
            "original_content": "Hello",
            "rewritten_content": "Hello",
        },
    ).json()


@pytest.fixture()
def no_gateway() -> Generator[None]:
    from app.config import settings

    orig = settings.llm_api_base
    settings.llm_api_base = None
    yield
    settings.llm_api_base = orig


# --- SSE wire format ---


@patch("app.services.llm_service.amessages", new_callable=AsyncMock)
def test_parse_stream_wire_format(mock_amessages: AsyncMock, client: TestClient) -> None:
    profile = client.post("/api/profiles", json={"name": "Test"}).json()
    mock_amessages.return_value = _aiter(
        _events(
            ["<meta>\nTitle: Song\nArtist: UNKNOWN\n</meta>\n", "<original>\nHi\n</original>"],
            ["think"],
        )
    )
    resp = client.post(
        "/api/parse/stream", json={"profile_id": profile["id"], "content": "Hi", **MODEL}
    )
    assert resp.headers["cache-control"] == "no-cache"
    assert resp.headers["x-accel-buffering"] == "no"
    assert resp.text == (
        'event: reasoning\ndata: "think"\n\n'
        'event: token\ndata: "<meta>\\nTitle: Song\\nArtist: UNKNOWN\\n</meta>\\n"\n\n'
        'event: token\ndata: "<original>\\nHi\\n</original>"\n\n'
        'event: done\ndata: {"original_content": "Hi", "title": "Song", "artist": null, '
        '"reasoning": "think", "usage": {"input_tokens": 10, "output_tokens": 20}}\n\n'
    )


@patch("app.services.llm_service.amessages", new_callable=AsyncMock)
def test_chat_stream_wire_format(mock_amessages: AsyncMock, client: TestClient) -> None:
    song = _song(client)
    mock_amessages.return_value = _aiter(_events(["<content>\nBye\n</content>", "\nDone."], ["t"]))
    resp = client.post(
        "/api/chat/stream",
        json={"song_id": song["id"], "messages": [{"role": "user", "content": "x"}], **MODEL},
    )
    assert resp.text == (
        'event: reasoning\ndata: "t"\n\n'
        'event: token\ndata: "<content>\\nBye\\n</content>"\n\n'
        'event: token\ndata: "\\nDone."\n\n'
        'event: done\ndata: {"rewritten_content": "Bye", "original_content": null, '
        '"assistant_message": "<content>\\nBye\\n</content>\\nDone.", '
        '"changes_summary": "Done.", "version": 2, "reasoning": "t", '
        '"usage": {"input_tokens": 10, "output_tokens": 20}}\n\n'
    )


@pytest.mark.parametrize("path", ["/api/parse/stream", "/api/chat/stream"])
def test_stream_error_frame_carries_error_type(path: str, client: TestClient) -> None:
    song = _song(client)
    body = {
        "profile_id": song["profile_id"],
        "song_id": song["id"],
        "content": "Hi",
        "messages": [{"role": "user", "content": "x"}],
        **MODEL,
    }
    err = RateLimitError("slow down", provider_name="otari")
    with patch("app.services.llm_service.amessages", new_callable=AsyncMock, side_effect=err):
        resp = client.post(path, json=body)
    frame = resp.text.split("event: error\ndata: ", 1)[1].split("\n\n", 1)[0]
    assert json.loads(frame)["error_type"] == "provider_rate_limit"


# --- Abandoned streams ---


@patch("app.services.llm_service.amessages", new_callable=AsyncMock)
def test_abandoned_stream_keeps_usage_seen_before_abandonment(
    mock_amessages: AsyncMock, client: TestClient, db_session: Session, test_user: User
) -> None:
    """Usage that arrived before Starlette dropped the generator is persisted.

    The abandoned-generator path used to start its background finisher without
    the usage collected so far, so a gateway that reports usage early lost it.
    """
    song = _song(client)
    mock_amessages.return_value = _aiter(
        _events(["<content>\nNew\n</content>", "\nDone."], usage_first=True)
    )
    req = ChatRequest(
        song_id=song["id"], messages=[{"role": "user", "content": "x"}], model="gpt-4o-mini"
    )
    request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))

    async def _run() -> None:
        resp = await rewrite.chat_stream(req, request, current_user=test_user, db=db_session)  # type: ignore[arg-type]
        frames = resp.body_iterator
        assert "event: token" in str(await frames.__anext__())
        await frames.aclose()  # type: ignore[attr-defined]
        pending = asyncio.all_tasks() - {asyncio.current_task()}
        await asyncio.gather(*pending)

    asyncio.run(_run())

    db_session.expire_all()
    reply = (
        db_session.query(ChatMessageModel)
        .filter(ChatMessageModel.song_id == song["id"], ChatMessageModel.role == "assistant")
        .one()
    )
    assert reply.content == "<content>\nNew\n</content>\nDone."
    assert (reply.input_tokens, reply.output_tokens) == (10, 20)


@patch("app.services.llm_service.amessages", new_callable=AsyncMock)
def test_disconnect_mid_stream_hands_off_and_saves_the_whole_reply(
    mock_amessages: AsyncMock, client: TestClient, db_session: Session, test_user: User
) -> None:
    """A disconnect seen by ``is_disconnected`` hands the stream to the background.

    The event that revealed the disconnect is kept, the rest of the reply and its
    usage arrive in the background, and no further frames are sent.
    """
    song = _song(client)
    mock_amessages.return_value = _aiter(_events(["<content>\nNew\n</content>", "\nDone."]))
    req = ChatRequest(
        song_id=song["id"], messages=[{"role": "user", "content": "x"}], model="gpt-4o-mini"
    )
    request = SimpleNamespace(is_disconnected=AsyncMock(side_effect=[False, True]))

    async def _run() -> list[str]:
        resp = await rewrite.chat_stream(req, request, current_user=test_user, db=db_session)  # type: ignore[arg-type]
        frames = [str(f) async for f in resp.body_iterator]
        pending = asyncio.all_tasks() - {asyncio.current_task()}
        await asyncio.gather(*pending)
        return frames

    frames = asyncio.run(_run())

    assert frames == ['event: token\ndata: "<content>\\nNew\\n</content>"\n\n']
    db_session.expire_all()
    reply = (
        db_session.query(ChatMessageModel)
        .filter(ChatMessageModel.song_id == song["id"], ChatMessageModel.role == "assistant")
        .one()
    )
    assert reply.content == "<content>\nNew\n</content>\nDone."
    assert (reply.input_tokens, reply.output_tokens) == (10, 20)


# --- Error shape ---


def test_follow_error_carries_error_type(client: TestClient) -> None:
    """Follow used to return ``str(e)``: a different shape, and a leaked SDK message."""
    err = RateLimitError("upstream said: secret detail", provider_name="otari")
    with patch("app.services.llm_service.amessages", new_callable=AsyncMock, side_effect=err):
        resp = client.post(
            "/api/follow/disambiguate",
            json={"recent_words": "hi", "candidates": [{"index": 1, "context": "hi"}], **MODEL},
        )
    assert resp.status_code == 502
    assert resp.json()["detail"]["error_type"] == "provider_rate_limit"
    assert "secret" not in resp.text


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/parse"),
        ("post", "/api/parse/stream"),
        ("post", "/api/parse/image"),
        ("post", "/api/chat"),
        ("post", "/api/chat/stream"),
        ("post", "/api/tags/suggest"),
        ("post", "/api/follow/disambiguate"),
        ("get", "/api/models"),
    ],
)
@pytest.mark.usefixtures("no_gateway")
def test_every_llm_route_requires_the_gateway(method: str, path: str, client: TestClient) -> None:
    song = _song(client)
    body = {
        "profile_id": song["profile_id"],
        "song_id": song["id"],
        "content": "Hi",
        "image": "data:image/png;base64,AAAA",
        "messages": [{"role": "user", "content": "x"}],
        "recent_words": "hi",
        "candidates": [{"index": 1, "context": "hi"}],
        **MODEL,
    }
    with patch("app.services.llm_service.amessages", new_callable=AsyncMock) as mock_amessages:
        resp = client.get(path) if method == "get" else client.post(path, json=body)
    assert resp.status_code == 503
    assert resp.json()["detail"]["error_type"] == "gateway_not_configured"
    mock_amessages.assert_not_called()


@pytest.mark.usefixtures("no_gateway")
def test_auth_failure_outranks_the_missing_gateway(client: TestClient) -> None:
    from fastapi import HTTPException

    from app.auth.dependencies import get_current_user
    from app.main import app

    def _reject() -> User:
        raise HTTPException(status_code=401, detail="nope")

    app.dependency_overrides[get_current_user] = _reject
    resp = client.get("/api/models")
    assert resp.status_code == 401
