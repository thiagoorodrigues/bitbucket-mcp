import type { ZodRawShape } from "zod";
import type { McpToolResponse } from "../errors.js";

export interface ToolDefinition {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema?: ZodRawShape;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any) => Promise<McpToolResponse>;
  /** Bitbucket scope most likely missing when this tool gets a 403. */
  scopeHint: string;
}
