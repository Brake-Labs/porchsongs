"""Follow-mode LLM arbiter: disambiguate which lyric line a singer is on.

The client's local position tracker handles the common case. It calls this only
at genuinely ambiguous moments (e.g. a chorus line identical across verses),
sending recognized text plus a few candidate lines and asking which one fits.
Text only; no audio ever reaches the server.
"""

from fastapi import APIRouter, Depends, HTTPException

from ..auth.dependencies import get_current_user
from ..config import settings
from ..models import User
from ..schemas import FollowDisambiguateRequest, FollowDisambiguateResponse
from ..services import llm_service

router = APIRouter(tags=["follow"])


# include_in_schema=False keeps this internal endpoint out of the OpenAPI spec
# (the frontend calls it with a plain fetch, not the generated typed client), so
# it does not churn frontend/src/generated/api.d.ts.
@router.post(
    "/follow/disambiguate",
    response_model=FollowDisambiguateResponse,
    include_in_schema=False,
)
async def disambiguate(
    req: FollowDisambiguateRequest,
    current_user: User = Depends(get_current_user),
) -> FollowDisambiguateResponse:
    if not settings.llm_api_base:
        raise HTTPException(status_code=503, detail="No LLM gateway configured")
    if not req.candidates:
        return FollowDisambiguateResponse(choice=None)
    try:
        result = await llm_service.disambiguate_position(
            recent_words=req.recent_words,
            candidates=[{"index": c.index, "context": c.context} for c in req.candidates],
            current_index=req.current_index,
            provider=settings.llm_provider,
            model=req.model,
            api_base=settings.llm_api_base,
            api_key=settings.llm_api_key,
            max_tokens=req.max_tokens,
        )
    except Exception as e:
        # Surface any gateway failure as 502; the client falls back to local.
        raise HTTPException(status_code=502, detail=str(e)) from None
    return FollowDisambiguateResponse(choice=result["choice"])
