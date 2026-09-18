import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BitbucketClient } from "../client.js";
import { registerTools } from "./register.js";
import { createAccountTools } from "./account.js";
import { createReposTools } from "./repos.js";
import { createCodeTools } from "./code.js";
import { createPullRequestTools } from "./pullrequests.js";
import { createPipelinesTools } from "./pipelines.js";
import type { ToolDefinition } from "./types.js";

export function collectAllTools(client: BitbucketClient): ToolDefinition[] {
  return [
    ...createAccountTools(client),
    ...createReposTools(client),
    ...createCodeTools(client),
    ...createPullRequestTools(client),
    ...createPipelinesTools(client)
  ];
}

export function registerAllTools(server: McpServer, client: BitbucketClient): void {
  registerTools(server, collectAllTools(client));
}
