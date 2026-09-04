import os
from collections.abc import Mapping
from typing import Any

from app.policy import CallerContext


def caller_from_claims(claims: Mapping[str, Any]) -> CallerContext:
    project_roles = claims.get(f"urn:zitadel:iam:org:project:{os.environ['ZITADEL_PROJECT_ID']}:roles")
    roles = tuple(sorted(project_roles)) if isinstance(project_roles, dict) else ()
    return CallerContext(
        sub=str(claims["sub"]),
        org_id=str(claims["urn:zitadel:iam:user:resourceowner:id"]),
        roles=roles,
    )
