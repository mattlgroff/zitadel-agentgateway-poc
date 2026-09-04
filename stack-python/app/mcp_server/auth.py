import os
from typing import Any

import jwt
from mcp.server.auth.provider import AccessToken, TokenVerifier


class ZitadelTokenVerifier(TokenVerifier):
    def __init__(self) -> None:
        self.jwks = jwt.PyJWKClient("http://proxy/oauth/v2/keys")

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            key = self.jwks.get_signing_key_from_jwt(token)
            claims: dict[str, Any] = jwt.decode(
                token,
                key.key,
                algorithms=["RS256"],
                audience=os.environ["ZITADEL_PROJECT_ID"],
                issuer="http://localhost:8080",
            )
        except jwt.PyJWTError:
            return None
        scope = claims.get("scope", "")
        scopes = scope.split() if isinstance(scope, str) else []
        return AccessToken(
            token=token,
            client_id=str(claims.get("client_id", "")),
            scopes=scopes,
            expires_at=int(claims["exp"]),
            resource="http://localhost:3000/mcp",
            subject=str(claims["sub"]),
            claims=claims,
        )
