import { z, type ZodRawShape } from "zod";
import type { BitbucketClient } from "../client.js";
import { seg } from "../client.js";
import { genericErrorResponse, type McpToolResponse } from "../errors.js";
import type { ToolDefinition } from "./types.js";

export const workspaceField = {
  workspace: z
    .string()
    .min(1)
    .optional()
    .describe('Workspace slug (e.g. "southti"). Defaults to BITBUCKET_WORKSPACE.')
};

export const repoFields = {
  ...workspaceField,
  repo_slug: z.string().min(1).describe('Repository slug, case-sensitive (e.g. "south-console").')
};

export const fieldsField = {
  fields: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Bitbucket partial-response selector. Examples: "values.id,values.title", "+values.reviewers", "-values.summary". Default removes all `links`.'
    )
};

export const filterFields = {
  q: z
    .string()
    .min(1)
    .optional()
    .describe('Bitbucket filter query, e.g. name ~ "feature/" or state = "OPEN" AND author.nickname = "x".'),
  sort: z
    .string()
    .min(1)
    .optional()
    .describe("Field to sort by; prefix with - for descending, e.g. -updated_on.")
};

export type RepoInput = { workspace?: string; repo_slug: string };

export function repoPath(client: BitbucketClient, input: RepoInput): string {
  return `/repositories/${seg(client.resolveWorkspace(input.workspace))}/${seg(input.repo_slug)}`;
}

/** Removes keys whose value is `undefined` (keeps null, "", 0, false). */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function truncateBytes(text: string, maxBytes: number): string {
  const total = Buffer.byteLength(text, "utf8");
  if (total <= maxBytes) return text;
  const cut = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8").replace(/�+$/, "");
  return `${cut}\n\n[truncated: showing ${maxBytes} of ${total} bytes]`;
}

export function tailLines(text: string, n: number): string {
  const lines = text.split("\n");
  if (lines.length <= n) return text;
  return `[showing last ${n} of ${lines.length} lines]\n${lines.slice(-n).join("\n")}`;
}

export function defineTool<S extends ZodRawShape>(def: {
  name: string;
  title: string;
  description: string;
  scopeHint: string;
  inputSchema: S;
  handler: (input: z.infer<z.ZodObject<S>>) => Promise<McpToolResponse>;
}): ToolDefinition {
  return {
    name: def.name,
    scopeHint: def.scopeHint,
    config: { title: def.title, description: def.description, inputSchema: def.inputSchema },
    handler: async (input) => {
      try {
        return await def.handler(input);
      } catch (e) {
        return genericErrorResponse(e, def.scopeHint);
      }
    }
  };
}
