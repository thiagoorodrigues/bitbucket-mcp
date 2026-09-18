import { z } from "zod";
import type { BitbucketClient } from "../client.js";
import { encodePath, seg } from "../client.js";
import { BitbucketApiError, successResponse, textResponse } from "../errors.js";
import { paginationFields, paginationParams } from "../pagination.js";
import { defineTool, fieldsField, repoFields, repoPath, truncateBytes, type RepoInput } from "./common.js";
import type { ToolDefinition } from "./types.js";

const DEFAULT_MAX_BYTES = 200_000;

/**
 * Bitbucket's `/src/{commit}/{path}` endpoint rejects a percent-encoded slash in `{commit}`
 * (e.g. `src/feature%2Fx/` -> 404), while `/refs/branches/{name}` and `/refs/tags/{name}` accept
 * it. When `ref` contains a slash, resolve it to a commit hash via those endpoints first.
 */
async function resolveRef(client: BitbucketClient, input: RepoInput, ref: string): Promise<string> {
  if (!ref.includes("/")) return ref;
  const base = repoPath(client, input);
  for (const kind of ["branches", "tags"] as const) {
    try {
      const data = await client.get<{ target?: { hash?: string } }>(`${base}/refs/${kind}/${seg(ref)}`, {
        fields: "target.hash"
      });
      if (data.target?.hash) return data.target.hash;
    } catch (e) {
      if (!(e instanceof BitbucketApiError) || e.status !== 404) throw e;
    }
  }
  return ref;
}

export function createCodeTools(client: BitbucketClient): ToolDefinition[] {
  return [
    defineTool({
      name: "commits_list",
      title: "List Commits",
      description:
        "List commits, newest first. Optional `revision` (branch, tag or hash) starts from that point; `path` limits to commits touching a file; `include`/`exclude` build ranges (e.g. include feature/x, exclude master = commits only on feature/x). Pagination here uses an opaque cursor: pass the `page` value found in the `next` URL of the previous response.",
      scopeHint: "repository",
      inputSchema: {
        ...repoFields,
        revision: z.string().min(1).optional().describe("Branch, tag or commit hash to start from."),
        path: z.string().min(1).optional().describe("Only commits that touch this file path."),
        include: z.array(z.string().min(1)).optional().describe("Refs/hashes to include (repeatable)."),
        exclude: z.array(z.string().min(1)).optional().describe("Refs/hashes whose ancestors are excluded."),
        ...fieldsField,
        ...paginationFields
      },
      handler: async (input) => {
        const base = `${repoPath(client, input)}/commits`;
        const path = input.revision ? `${base}/${seg(input.revision)}` : base;
        return successResponse(
          await client.get(path, {
            path: input.path,
            include: input.include,
            exclude: input.exclude,
            fields: input.fields,
            ...paginationParams(input)
          })
        );
      }
    }),
    defineTool({
      name: "commits_get",
      title: "Get Commit",
      description: "Get one commit by hash: message, author, date, parents.",
      scopeHint: "repository",
      inputSchema: { ...repoFields, hash: z.string().min(1).describe("Full or short commit hash."), ...fieldsField },
      handler: async (input) =>
        successResponse(await client.get(`${repoPath(client, input)}/commit/${seg(input.hash)}`, { fields: input.fields }))
    }),
    defineTool({
      name: "diff_get",
      title: "Get Diff",
      description:
        'Unified diff for a commit or between two refs. `spec` is a hash (diff against its parent) or "source..destination" (e.g. "feature/x..master" shows what feature/x adds to master). Set `diffstat` to true for a JSON per-file summary instead of the patch. `fields`, `page` and `pagelen` apply only when `diffstat` is true.',
      scopeHint: "repository",
      inputSchema: {
        ...repoFields,
        spec: z.string().min(1).describe('Commit hash or "source..destination".'),
        path: z.string().min(1).optional().describe("Limit the diff to this file path."),
        context: z.number().int().min(0).optional().describe("Context lines around changes (patch only)."),
        diffstat: z.boolean().optional().describe("Return JSON diffstat instead of the raw patch."),
        ...fieldsField,
        ...paginationFields
      },
      handler: async (input) => {
        const base = repoPath(client, input);
        if (input.diffstat) {
          return successResponse(
            await client.get(`${base}/diffstat/${seg(input.spec)}`, {
              path: input.path,
              fields: input.fields,
              ...paginationParams(input)
            })
          );
        }
        const patch = await client.getText(`${base}/diff/${seg(input.spec)}`, {
          path: input.path,
          context: input.context
        });
        return textResponse(patch);
      }
    }),
    defineTool({
      name: "src_read",
      title: "Read Source",
      description:
        'Read a file or list a directory at a given commit/branch/tag. Empty `path` lists the repository root. Directories return a paginated JSON listing (type "commit_file" or "commit_directory"); files return their raw content, truncated at `max_bytes`. Branch or tag names containing `/` are resolved to a commit hash first (Bitbucket rejects an encoded slash in this endpoint\'s commit segment).',
      scopeHint: "repository",
      inputSchema: {
        ...repoFields,
        commit: z.string().min(1).describe("Branch, tag or commit hash."),
        path: z.string().default("").describe("File or directory path; empty for the root."),
        max_bytes: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(`Truncate file content beyond this many bytes (default ${DEFAULT_MAX_BYTES}).`),
        ...paginationFields
      },
      handler: async (input) => {
        const encoded = encodePath(input.path);
        const commit = await resolveRef(client, input, input.commit);
        const path = `${repoPath(client, input)}/src/${seg(commit)}/${encoded}`;
        const raw = await client.getRaw(path, { ...paginationParams(input) });
        if (raw.contentType.includes("json")) {
          return successResponse(JSON.parse(raw.text));
        }
        return textResponse(truncateBytes(raw.text, input.max_bytes ?? DEFAULT_MAX_BYTES));
      }
    })
  ];
}
