import { z } from "zod";
import type { BitbucketClient } from "../client.js";
import { seg } from "../client.js";
import { successResponse, textResponse } from "../errors.js";
import { paginationFields, paginationParams } from "../pagination.js";
import { defineTool, fieldsField, repoFields, repoPath, tailLines } from "./common.js";
import type { ToolDefinition } from "./types.js";

const DEFAULT_TAIL_LINES = 300;

const uuidField = { uuid: z.string().min(1).describe("Pipeline UUID including braces, e.g. {1a2b-...}, as returned by pipelines_list.") };

export function createPipelinesTools(client: BitbucketClient): ToolDefinition[] {
  return [
    defineTool({
      name: "pipelines_list",
      title: "List Pipelines",
      description:
        "List pipeline runs of a repository, newest first by default. `target_branch` filters runs for a branch. Each run has state (PENDING, IN_PROGRESS, COMPLETED), result (SUCCESSFUL, FAILED, STOPPED), build_number and uuid.",
      scopeHint: "pipeline",
      inputSchema: {
        ...repoFields,
        target_branch: z.string().min(1).optional().describe("Only runs triggered for this branch."),
        sort: z.string().min(1).optional().describe("Sort field, default -created_on."),
        ...fieldsField,
        ...paginationFields
      },
      handler: async (input) =>
        successResponse(
          await client.get(`${repoPath(client, input)}/pipelines`, {
            sort: input.sort ?? "-created_on",
            q: input.target_branch ? `target.ref_name="${input.target_branch}"` : undefined,
            fields: input.fields,
            ...paginationParams(input)
          })
        )
    }),
    defineTool({
      name: "pipelines_get",
      title: "Get Pipeline",
      description: "Get one pipeline run: state, result, trigger, target commit/branch, duration.",
      scopeHint: "pipeline",
      inputSchema: { ...repoFields, ...uuidField, ...fieldsField },
      handler: async (input) =>
        successResponse(await client.get(`${repoPath(client, input)}/pipelines/${seg(input.uuid)}`, { fields: input.fields }))
    }),
    defineTool({
      name: "pipelines_steps_list",
      title: "List Pipeline Steps",
      description: "List the steps of a pipeline run with their state/result and uuid (needed for pipelines_step_log).",
      scopeHint: "pipeline",
      inputSchema: { ...repoFields, ...uuidField, ...fieldsField, ...paginationFields },
      handler: async (input) =>
        successResponse(
          await client.get(`${repoPath(client, input)}/pipelines/${seg(input.uuid)}/steps`, {
            fields: input.fields,
            ...paginationParams(input)
          })
        )
    }),
    defineTool({
      name: "pipelines_step_log",
      title: "Get Pipeline Step Log",
      description: `Raw log of a pipeline step. Returns only the last \`tail_lines\` lines (default ${DEFAULT_TAIL_LINES}) with a header showing the total when truncated.`,
      scopeHint: "pipeline",
      inputSchema: {
        ...repoFields,
        ...uuidField,
        step_uuid: z.string().min(1).describe("Step UUID including braces, from pipelines_steps_list."),
        tail_lines: z.number().int().min(1).optional().describe(`Lines to keep from the end (default ${DEFAULT_TAIL_LINES}).`)
      },
      handler: async (input) => {
        const log = await client.getText(
          `${repoPath(client, input)}/pipelines/${seg(input.uuid)}/steps/${seg(input.step_uuid)}/log`
        );
        return textResponse(tailLines(log, input.tail_lines ?? DEFAULT_TAIL_LINES));
      }
    })
  ];
}
