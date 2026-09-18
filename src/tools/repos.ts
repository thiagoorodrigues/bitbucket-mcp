import { z } from "zod";
import type { BitbucketClient } from "../client.js";
import { seg } from "../client.js";
import { successResponse } from "../errors.js";
import { paginationFields, paginationParams } from "../pagination.js";
import { defineTool, fieldsField, filterFields, repoFields, repoPath, workspaceField } from "./common.js";
import type { ToolDefinition } from "./types.js";

export function createReposTools(client: BitbucketClient): ToolDefinition[] {
  return [
    defineTool({
      name: "repos_list",
      title: "List Repositories",
      description:
        'List repositories in a workspace. Filter with `role` (your relationship to the repo) and `q` (e.g. name ~ "console" or project.key = "SOUTH"); sort with e.g. -updated_on.',
      scopeHint: "repository",
      inputSchema: {
        ...workspaceField,
        role: z
          .enum(["admin", "contributor", "member", "owner"])
          .optional()
          .describe("Only repos where the token has at least this role."),
        ...filterFields,
        ...fieldsField,
        ...paginationFields
      },
      handler: async (input) => {
        const ws = client.resolveWorkspace(input.workspace);
        return successResponse(
          await client.get(`/repositories/${seg(ws)}`, {
            role: input.role,
            q: input.q,
            sort: input.sort,
            fields: input.fields,
            ...paginationParams(input)
          })
        );
      }
    }),
    defineTool({
      name: "repos_get",
      title: "Get Repository",
      description: "Get one repository by slug: main branch, project, size, language, dates.",
      scopeHint: "repository",
      inputSchema: { ...repoFields, ...fieldsField },
      handler: async (input) => successResponse(await client.get(repoPath(client, input), { fields: input.fields }))
    }),
    defineTool({
      name: "branches_list",
      title: "List Branches",
      description:
        'List branches of a repository with their target commit. Filter with `q` (e.g. name ~ "feature/") and sort with e.g. -target.date.',
      scopeHint: "repository",
      inputSchema: { ...repoFields, ...filterFields, ...fieldsField, ...paginationFields },
      handler: async (input) =>
        successResponse(
          await client.get(`${repoPath(client, input)}/refs/branches`, {
            q: input.q,
            sort: input.sort,
            fields: input.fields,
            ...paginationParams(input)
          })
        )
    }),
    defineTool({
      name: "tags_list",
      title: "List Tags",
      description: 'List tags of a repository. Filter with `q` (e.g. name ~ "v1.") and sort with e.g. -target.date.',
      scopeHint: "repository",
      inputSchema: { ...repoFields, ...filterFields, ...fieldsField, ...paginationFields },
      handler: async (input) =>
        successResponse(
          await client.get(`${repoPath(client, input)}/refs/tags`, {
            q: input.q,
            sort: input.sort,
            fields: input.fields,
            ...paginationParams(input)
          })
        )
    })
  ];
}
