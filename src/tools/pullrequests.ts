import { z } from "zod";
import type { BitbucketClient } from "../client.js";
import { successResponse, textResponse } from "../errors.js";
import { paginationFields, paginationParams } from "../pagination.js";
import { compact, defineTool, fieldsField, filterFields, repoFields, repoPath, type RepoInput } from "./common.js";
import type { ToolDefinition } from "./types.js";

const idField = { id: z.number().int().positive().describe("Pull request ID (the number in the PR URL).") };

const PR_STATES = ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"] as const;

function prPath(client: BitbucketClient, input: RepoInput, id: number): string {
  return `${repoPath(client, input)}/pullrequests/${id}`;
}

function listSubResource(
  client: BitbucketClient,
  name: string,
  title: string,
  sub: string,
  description: string
): ToolDefinition {
  return defineTool({
    name,
    title,
    description,
    scopeHint: "pullrequest",
    inputSchema: { ...repoFields, ...idField, ...fieldsField, ...paginationFields },
    handler: async (input) =>
      successResponse(
        await client.get(`${prPath(client, input, input.id)}/${sub}`, {
          fields: input.fields,
          ...paginationParams(input)
        })
      )
  });
}

export function createPullRequestTools(client: BitbucketClient): ToolDefinition[] {
  const readTools: ToolDefinition[] = [
    defineTool({
      name: "prs_list",
      title: "List Pull Requests",
      description:
        'List pull requests of a repository. Defaults to OPEN when `state` is omitted; pass several states to combine. `q` supports e.g. author.nickname = "x", destination.branch.name = "master", created_on > 2026-01-01T00:00:00Z.',
      scopeHint: "pullrequest",
      inputSchema: {
        ...repoFields,
        state: z.array(z.enum(PR_STATES)).optional().describe("One or more of OPEN, MERGED, DECLINED, SUPERSEDED."),
        ...filterFields,
        ...fieldsField,
        ...paginationFields
      },
      handler: async (input) =>
        successResponse(
          await client.get(`${repoPath(client, input)}/pullrequests`, {
            state: input.state,
            q: input.q,
            sort: input.sort,
            fields: input.fields,
            ...paginationParams(input)
          })
        )
    }),
    defineTool({
      name: "prs_get",
      title: "Get Pull Request",
      description: "Get one pull request: title, description, state, source/destination branches, author, reviewers, participants (approvals), merge commit.",
      scopeHint: "pullrequest",
      inputSchema: { ...repoFields, ...idField, ...fieldsField },
      handler: async (input) =>
        successResponse(await client.get(prPath(client, input, input.id), { fields: input.fields }))
    }),
    defineTool({
      name: "prs_diff",
      title: "Get Pull Request Diff",
      description: "Unified diff of a pull request against its destination. Set `diffstat` to true for a JSON per-file summary (status, lines added/removed) instead of the patch.",
      scopeHint: "pullrequest",
      inputSchema: {
        ...repoFields,
        ...idField,
        diffstat: z.boolean().optional().describe("Return JSON diffstat instead of the raw patch."),
        ...fieldsField,
        ...paginationFields
      },
      handler: async (input) => {
        const base = prPath(client, input, input.id);
        if (input.diffstat) {
          return successResponse(
            await client.get(`${base}/diffstat`, { fields: input.fields, ...paginationParams(input) })
          );
        }
        return textResponse(await client.getText(`${base}/diff`));
      }
    }),
    listSubResource(client, "prs_commits", "List Pull Request Commits", "commits", "Commits included in a pull request, newest first."),
    listSubResource(client, "prs_comments_list", "List Pull Request Comments", "comments", "Comments on a pull request, including inline comments (see `inline.path`/`inline.to`) and replies (`parent.id`)."),
    listSubResource(client, "prs_activity", "Get Pull Request Activity", "activity", "Activity timeline: approvals, changes requested, updates, comments."),
    listSubResource(client, "prs_statuses", "List Pull Request Build Statuses", "statuses", "Commit statuses (pipelines, CI) reported on the pull request's source commit.")
  ];

  return [...readTools, ...createWriteTools(client)];
}

function createWriteTools(_client: BitbucketClient): ToolDefinition[] {
  return []; // filled in Task 11
}

export { compact, prPath, idField };
