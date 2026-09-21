import type { BitbucketClient } from "../client.js";
import { seg } from "../client.js";
import { successResponse } from "../errors.js";
import { paginationFields, paginationParams } from "../pagination.js";
import { defineTool, fieldsField, filterFields, workspaceField } from "./common.js";
import type { ToolDefinition } from "./types.js";

export function createAccountTools(client: BitbucketClient): ToolDefinition[] {
  return [
    defineTool({
      name: "user_me",
      title: "Get Current User",
      description:
        "Return the authenticated user (GET /user). Works only with an Atlassian API token (BITBUCKET_EMAIL + BITBUCKET_API_TOKEN). Workspace/project/repository access tokens are not users and receive 401/403 here.",
      scopeHint: "account",
      inputSchema: { ...fieldsField },
      handler: async (input) => successResponse(await client.get("/user", { fields: input.fields }))
    }),
    defineTool({
      name: "workspaces_list",
      title: "List Workspaces",
      description:
        'List workspaces the token can access. Supports Bitbucket filter `q` (e.g. slug="southti"), `sort` and pagination.',
      scopeHint: "account",
      inputSchema: { ...filterFields, ...fieldsField, ...paginationFields },
      handler: async (input) =>
        successResponse(
          await client.get("/workspaces", {
            q: input.q,
            sort: input.sort,
            fields: input.fields,
            ...paginationParams(input)
          })
        )
    }),
    defineTool({
      name: "projects_list",
      title: "List Projects",
      description:
        'List projects in a workspace. Supports `q` (e.g. name ~ "Console"), `sort` (e.g. -updated_on) and pagination.',
      scopeHint: "project",
      inputSchema: { ...workspaceField, ...filterFields, ...fieldsField, ...paginationFields },
      handler: async (input) => {
        const ws = client.resolveWorkspace(input.workspace);
        return successResponse(
          await client.get(`/workspaces/${seg(ws)}/projects`, {
            q: input.q,
            sort: input.sort,
            fields: input.fields,
            ...paginationParams(input)
          })
        );
      }
    })
  ];
}
