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
      description:
        "Unified diff of a pull request against its destination. Set `diffstat` to true for a JSON per-file summary (status, lines added/removed) instead of the patch. `fields`, `page` and `pagelen` apply only when `diffstat` is true.",
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

const MERGE_STRATEGIES = ["merge_commit", "squash", "fast_forward"] as const;

function createWriteTools(client: BitbucketClient): ToolDefinition[] {
  return [
    defineTool({
      name: "prs_create",
      title: "Create Pull Request",
      description:
        "Open a pull request from `source_branch` into `destination_branch` (defaults to the repository's main branch). `reviewers` takes user UUIDs (with braces) as returned by prs_get/user_me. Returns the created PR.",
      scopeHint: "pullrequest:write",
      inputSchema: {
        ...repoFields,
        title: z.string().min(1),
        source_branch: z.string().min(1).describe("Branch with the changes."),
        destination_branch: z.string().min(1).optional().describe("Target branch; defaults to the main branch."),
        description: z.string().optional().describe("Markdown description."),
        reviewers: z.array(z.string().min(1)).optional().describe("Reviewer user UUIDs, e.g. {a1b2-...}."),
        close_source_branch: z.boolean().optional().describe("Delete the source branch after merge."),
        draft: z.boolean().optional()
      },
      handler: async (input) => {
        const payload = compact({
          title: input.title,
          description: input.description,
          source: { branch: { name: input.source_branch } },
          destination: input.destination_branch ? { branch: { name: input.destination_branch } } : undefined,
          reviewers: input.reviewers?.map((uuid) => ({ uuid })),
          close_source_branch: input.close_source_branch,
          draft: input.draft
        });
        return successResponse(await client.post(`${repoPath(client, input)}/pullrequests`, payload));
      }
    }),
    defineTool({
      name: "prs_update",
      title: "Update Pull Request",
      description:
        "Update title, description, destination branch, reviewers, close-source-branch flag or draft state of an open pull request. Fields you omit keep their current value (the tool reads the PR first).",
      scopeHint: "pullrequest:write",
      inputSchema: {
        ...repoFields,
        ...idField,
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        destination_branch: z.string().min(1).optional(),
        reviewers: z.array(z.string().min(1)).optional().describe("Replaces the full reviewer list (user UUIDs)."),
        close_source_branch: z.boolean().optional(),
        draft: z.boolean().optional()
      },
      handler: async (input) => {
        const path = prPath(client, input, input.id);
        // Bitbucket's PUT may reset omitted mutable fields (reviewers in particular), so fetch
        // the current PR first and overlay the supplied inputs onto it.
        const current = await client.get<{
          title?: string;
          description?: string | { raw?: string };
          destination?: { branch?: { name?: string } };
          reviewers?: { uuid?: string }[];
          close_source_branch?: boolean;
          draft?: boolean;
        }>(path, {
          fields: "title,description,destination.branch.name,reviewers.uuid,close_source_branch,draft"
        });
        const currentDescription = typeof current.description === "string" ? current.description : current.description?.raw;
        const destinationBranch = input.destination_branch ?? current.destination?.branch?.name;
        const payload = compact({
          title: input.title ?? current.title,
          description: input.description ?? currentDescription,
          destination: destinationBranch ? { branch: { name: destinationBranch } } : undefined,
          reviewers: (input.reviewers ?? current.reviewers?.map((r) => r.uuid).filter((u): u is string => !!u) ?? []).map(
            (uuid) => ({ uuid })
          ),
          close_source_branch: input.close_source_branch ?? current.close_source_branch,
          draft: input.draft ?? current.draft
        });
        return successResponse(await client.put(path, payload));
      }
    }),
    defineTool({
      name: "prs_comment_create",
      title: "Comment on Pull Request",
      description:
        "Add a markdown comment to a pull request. Use `parent_id` to reply to an existing comment and `inline` ({ path, to }) to attach it to a line of the new file (`from` for a line of the old file).",
      scopeHint: "pullrequest",
      inputSchema: {
        ...repoFields,
        ...idField,
        content: z.string().min(1).describe("Comment body in markdown."),
        parent_id: z.number().int().positive().optional().describe("ID of the comment being replied to."),
        inline: z
          .object({
            path: z.string().min(1).describe("File path in the diff."),
            to: z.number().int().positive().optional().describe("Line number in the new version."),
            from: z.number().int().positive().optional().describe("Line number in the old version.")
          })
          .optional()
      },
      handler: async (input) => {
        const payload = compact({
          content: { raw: input.content },
          parent: input.parent_id !== undefined ? { id: input.parent_id } : undefined,
          inline: input.inline ? compact({ path: input.inline.path, to: input.inline.to, from: input.inline.from }) : undefined
        });
        return successResponse(await client.post(`${prPath(client, input, input.id)}/comments`, payload));
      }
    }),
    defineTool({
      name: "prs_approve",
      title: "Approve Pull Request",
      description: "Approve a pull request as the authenticated user/token.",
      scopeHint: "pullrequest:write",
      inputSchema: { ...repoFields, ...idField },
      handler: async (input) => successResponse(await client.post(`${prPath(client, input, input.id)}/approve`))
    }),
    defineTool({
      name: "prs_unapprove",
      title: "Remove Pull Request Approval",
      description: "Withdraw the authenticated user's approval from a pull request.",
      scopeHint: "pullrequest:write",
      inputSchema: { ...repoFields, ...idField },
      handler: async (input) => {
        await client.delete(`${prPath(client, input, input.id)}/approve`);
        return successResponse({ id: input.id, approved: false });
      }
    }),
    defineTool({
      name: "prs_request_changes",
      title: "Request Changes on Pull Request",
      description: "Mark a pull request as 'changes requested'. Set `revoke` to true to remove that mark.",
      scopeHint: "pullrequest:write",
      inputSchema: { ...repoFields, ...idField, revoke: z.boolean().optional().describe("Remove the changes-requested status.") },
      handler: async (input) => {
        const path = `${prPath(client, input, input.id)}/request-changes`;
        if (input.revoke) {
          await client.delete(path);
          return successResponse({ id: input.id, changes_requested: false });
        }
        return successResponse(await client.post(path));
      }
    }),
    defineTool({
      name: "prs_merge",
      title: "Merge Pull Request",
      description:
        "Merge an open pull request. `merge_strategy`: merge_commit (default), squash or fast_forward. Bitbucket may answer 202 with a poll link for large merges; call prs_get afterwards to confirm state MERGED.",
      scopeHint: "pullrequest:write",
      inputSchema: {
        ...repoFields,
        ...idField,
        merge_strategy: z.enum(MERGE_STRATEGIES).optional(),
        message: z.string().optional().describe("Merge commit message."),
        close_source_branch: z.boolean().optional()
      },
      handler: async (input) => {
        const payload = compact({
          type: "pullrequest",
          merge_strategy: input.merge_strategy,
          message: input.message,
          close_source_branch: input.close_source_branch
        });
        return successResponse(await client.post(`${prPath(client, input, input.id)}/merge`, payload));
      }
    }),
    defineTool({
      name: "prs_decline",
      title: "Decline Pull Request",
      description: "Decline (close without merging) an open pull request.",
      scopeHint: "pullrequest:write",
      inputSchema: { ...repoFields, ...idField },
      handler: async (input) => successResponse(await client.post(`${prPath(client, input, input.id)}/decline`))
    })
  ];
}
