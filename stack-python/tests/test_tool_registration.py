from pydantic_ai import Agent

from app.mcp_server.server import mcp_tools
from app.tools import TOOLS, ToolContext


def test_same_five_function_objects_are_registered_twice() -> None:
    agent = Agent("test", deps_type=ToolContext, tools=TOOLS)
    agent_functions = {tool.function for tool in agent._function_toolset.tools.values()}
    mcp_functions = {tool.fn for tool in mcp_tools}
    assert agent_functions == mcp_functions == set(TOOLS)
    assert len(TOOLS) == 5


def test_framework_context_is_not_in_either_schema() -> None:
    agent = Agent("test", deps_type=ToolContext, tools=TOOLS)
    assert all("ctx" not in tool.parameters.get("properties", {}) for tool in mcp_tools)
    assert all(
        "ctx" not in tool.function_schema.json_schema.get("properties", {})
        for tool in agent._function_toolset.tools.values()
    )
