import { describe, it, expect } from "vitest";
import { z } from "zod";
import { BitbucketClient } from "../../src/client.js";
import { collectAllTools } from "../../src/tools/index.js";
import { baseConfig, installFetch } from "../helpers.js";

/**
 * One valid sample input per tool name (all 30). Handlers are normally exercised with
 * hand-built objects in their own test files, so a mismatch between a declared zod input
 * and what a handler actually reads would slip through. This table-driven test parses each
 * sample with the tool's own zod schema (catching schema/handler drift) and then runs the
 * handler against a default `{}` JSON response, asserting it does not report an error.
 */
const samples: Record<string, unknown> = {
  user_me: {},
  workspaces_list: {},
  projects_list: {},
  repos_list: {},
  repos_get: { repo_slug: "r" },
  branches_list: { repo_slug: "r" },
  tags_list: { repo_slug: "r" },
  commits_list: { repo_slug: "r" },
  commits_get: { repo_slug: "r", hash: "abc" },
  diff_get: { repo_slug: "r", spec: "abc" },
  // `path` intentionally omitted so the `.default("")` on src_read is exercised.
  src_read: { repo_slug: "r", commit: "main" },
  prs_list: { repo_slug: "r" },
  prs_get: { repo_slug: "r", id: 1 },
  prs_diff: { repo_slug: "r", id: 1 },
  prs_commits: { repo_slug: "r", id: 1 },
  prs_comments_list: { repo_slug: "r", id: 1 },
  prs_activity: { repo_slug: "r", id: 1 },
  prs_statuses: { repo_slug: "r", id: 1 },
  prs_create: { repo_slug: "r", title: "Feat", source_branch: "feature/x" },
  prs_update: { repo_slug: "r", id: 1 },
  prs_comment_create: { repo_slug: "r", id: 1, content: "LGTM" },
  prs_approve: { repo_slug: "r", id: 1 },
  prs_unapprove: { repo_slug: "r", id: 1 },
  prs_request_changes: { repo_slug: "r", id: 1 },
  prs_merge: { repo_slug: "r", id: 1, merge_strategy: "squash" },
  prs_decline: { repo_slug: "r", id: 1 },
  pipelines_list: { repo_slug: "r" },
  pipelines_get: { repo_slug: "r", uuid: "{p}" },
  pipelines_steps_list: { repo_slug: "r", uuid: "{p}" },
  pipelines_step_log: { repo_slug: "r", uuid: "{p}", step_uuid: "{s}" }
};

describe("tool schemas round-trip", () => {
  const tools = collectAllTools(new BitbucketClient(baseConfig));

  it("covers all 30 tools with a sample", () => {
    expect(tools.length).toBe(30);
    for (const t of tools) {
      expect(samples, t.name).toHaveProperty(t.name);
    }
  });

  for (const t of tools) {
    it(`${t.name}: sample input matches the declared schema and the handler succeeds`, async () => {
      expect(samples, t.name).toHaveProperty(t.name);
      const parsed = z.object(t.config.inputSchema ?? {}).parse(samples[t.name]);
      installFetch();
      const res = await t.handler(parsed);
      expect(res.isError, `${t.name}: ${JSON.stringify(res)}`).not.toBe(true);
    });
  }
});
