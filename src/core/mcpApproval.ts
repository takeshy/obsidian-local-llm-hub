// The MCP tool approval gate lives in the shared library, which compares a spawn the way
// it will actually run so permission never transfers to a different executable.
export {
  requireMcpApproval,
  setMcpApprovalHandler,
  sameMcpConnection,
  type McpApprovalDecision,
  type McpApprovalHandler,
} from "obsidian-llm-hub-common/mcp";
