import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDefinition } from "./types.js";

export function registerTools(server: McpServer, tools: ToolDefinition[]): void {
  for (const tool of tools) {
    server.registerTool(tool.name, tool.config, tool.handler);
  }
}
