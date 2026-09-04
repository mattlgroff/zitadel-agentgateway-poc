from fastapi import Header, HTTPException
from mcp.server.auth.provider import AccessToken

from app.identity import caller_from_claims
from app.policy import CallerContext

from .mcp_server.server import token_verifier


async def access_token(authorization: str | None = Header(default=None)) -> AccessToken:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, headers={"WWW-Authenticate": 'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"'})
    verified = await token_verifier.verify_token(authorization[7:])
    if verified is None:
        raise HTTPException(401, headers={"WWW-Authenticate": 'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"'})
    return verified


def caller_from_token(token: AccessToken) -> CallerContext:
    return caller_from_claims(token.claims or {})
