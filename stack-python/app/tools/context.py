import os
from dataclasses import dataclass

from mcp.server.auth.middleware.auth_context import get_access_token
from pydantic_ai import RunContext

from app.identity import caller_from_claims
from app.policy import CallerContext
from app.upstream import CwsClient


@dataclass(frozen=True)
class ToolContext:
    caller: CallerContext
    approved_decisions: tuple[tuple[str, str], ...] = ()

    @property
    def tenant(self) -> str:
        mapping = {
            os.environ["ACME_ORG_ID"]: "acme",
            os.environ["GLOBEX_ORG_ID"]: "globex",
        }
        return mapping[self.caller.org_id]

    @property
    def manager_id(self) -> str:
        mapping = {
            os.environ["ADA_SUB"]: "ada",
            os.environ["MARGARET_SUB"]: "margaret",
        }
        return mapping.get(self.caller.sub, self.caller.sub)

    @property
    def cws(self) -> CwsClient:
        return CwsClient(os.environ["MOCK_CWS_URL"])

    @property
    def policy_caller(self) -> CallerContext:
        return self.caller.model_copy(update={"org_id": self.tenant, "sub": self.manager_id})


def resolve_context(ctx: RunContext[ToolContext] | None) -> ToolContext:
    if isinstance(ctx, RunContext):
        return ctx.deps
    access_token = get_access_token()
    if access_token is None or access_token.claims is None:
        raise RuntimeError("Authenticated MCP access token context is unavailable.")
    return ToolContext(caller_from_claims(access_token.claims))
