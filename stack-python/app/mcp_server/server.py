from pydantic import AnyHttpUrl

from mcp.server import MCPServer
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver.tools import Tool as McpTool

from app.tools import TOOLS

from .auth import ZitadelTokenVerifier


mcp_tools = [McpTool.from_function(fn, context_kwarg="ctx", structured_output=True) for fn in TOOLS]
for tool in mcp_tools:
    tool.parameters["additionalProperties"] = False
token_verifier = ZitadelTokenVerifier()
mcp = MCPServer(
    "timesheet-approvals-python",
    version="1.0.0",
    tools=mcp_tools,
    token_verifier=token_verifier,
    auth=AuthSettings(
        issuer_url=AnyHttpUrl("http://localhost:4200"),
        resource_server_url=AnyHttpUrl("http://localhost:3000/mcp"),
        required_scopes=[],
    ),
)
mcp_app = mcp.streamable_http_app(
    streamable_http_path="/mcp",
    stateless_http=True,
    host="0.0.0.0",
)
