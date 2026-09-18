# bitbucket-cloud-mcp

MCP server for [Bitbucket Cloud](https://bitbucket.org) — exposes the Bitbucket REST API 2.0 as tools usable by Claude and other MCP clients.

**Status:** v0.1. 30 tools: account/workspace, repositories, branches/tags, commits, diffs, file reading, pull requests (read + create/comment/approve/merge/decline) and pipelines (runs, steps, logs).

## Prerequisites

- **Node.js 18+**
- Bitbucket credentials (see [Getting your credentials](#getting-your-credentials))

## Installation

Your MCP client launches the server via `npx`; nothing to install by hand.

### Claude Code (CLI)

```bash
claude mcp add --scope user bitbucket \
  -e BITBUCKET_EMAIL=you@company.com \
  -e BITBUCKET_API_TOKEN=your-api-token \
  -e BITBUCKET_WORKSPACE=your-workspace \
  -- npx -y bitbucket-cloud-mcp
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "npx",
      "args": ["-y", "bitbucket-cloud-mcp"],
      "env": {
        "BITBUCKET_EMAIL": "you@company.com",
        "BITBUCKET_API_TOKEN": "your-api-token",
        "BITBUCKET_WORKSPACE": "your-workspace"
      }
    }
  }
}
```

### VS Code (Claude extension) / Cursor

Same JSON block under `mcpServers` in the client's MCP settings file.

## Getting your credentials

### Option A — Atlassian API token (personal, recommended)

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens → **Create API token with scopes** → product **Bitbucket**.
2. Select the scopes from the table below. Tokens expire (max 1 year).
3. Set `BITBUCKET_EMAIL` (your Atlassian e-mail) and `BITBUCKET_API_TOKEN`.

Actions appear in Bitbucket under your name.

### Option B — Workspace / project / repository access token

Bitbucket → workspace (or project/repo) **Settings → Access tokens → Create**. Set `BITBUCKET_ACCESS_TOKEN`. Actions appear under the token's name. `user_me` does not work with access tokens.

### Required scopes

| Tools | API token scopes | Access-token / OAuth scopes |
|---|---|---|
| `user_me`, `workspaces_list` | `read:user:bitbucket`, `read:workspace:bitbucket` | `account` |
| `projects_list` | `read:project:bitbucket` | `project` |
| `repos_*`, `branches_list`, `tags_list`, `commits_*`, `diff_get`, `src_read` | `read:repository:bitbucket` | `repository` |
| `prs_*` read + `prs_comment_create` | `read:pullrequest:bitbucket` | `pullrequest` |
| `prs_create/update/approve/unapprove/request_changes/merge/decline` | `write:pullrequest:bitbucket` | `pullrequest:write` |
| `pipelines_*` | `read:pipeline:bitbucket` | `pipeline` |

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `BITBUCKET_ACCESS_TOKEN` | one of | Access token (Bearer). Wins over e-mail + API token. |
| `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN` | one of | Atlassian e-mail + API token (Basic). |
| `BITBUCKET_WORKSPACE` | no | Default workspace slug when a tool call omits `workspace`. |
| `BITBUCKET_BASE_URL` | no | Default `https://api.bitbucket.org/2.0`. |
| `BITBUCKET_TIMEOUT_MS` | no | Default `30000`. |
| `LOG_LEVEL` | no | `debug` / `info` / `warn` / `error`, default `info`. Logs go to stderr. |

## Tools (30)

Every workspace- or repository-level tool accepts `workspace?` (falls back to `BITBUCKET_WORKSPACE`), and every repository tool takes `repo_slug`. Most read tools accept `fields?` (comma list to shrink the response) and `page?`/`pagelen?` for pagination.

### Account and workspace (read)

| Tool | Endpoint | Notes |
|---|---|---|
| `user_me` | `GET /user` | Authenticated user. Only works with an API token; access tokens get 401/403. |
| `workspaces_list` | `GET /workspaces` | Workspaces the token can access. Supports `q`, `sort`. |
| `projects_list` | `GET /workspaces/{ws}/projects` | Projects in a workspace. Supports `q`, `sort`. |

### Repositories (read)

| Tool | Endpoint | Notes |
|---|---|---|
| `repos_list` | `GET /repositories/{ws}` | Filter with `q`, `sort`, `role` (`admin`\|`contributor`\|`member`\|`owner`). |
| `repos_get` | `GET /repositories/{ws}/{repo_slug}` | One repository: main branch, project, size, language, dates. |
| `branches_list` | `GET .../refs/branches` | Branches with target commit. Supports `q`, `sort`. |
| `tags_list` | `GET .../refs/tags` | Tags with target commit. Supports `q`, `sort`. |

### Code (read)

| Tool | Endpoint | Notes |
|---|---|---|
| `commits_list` | `GET .../commits[/{revision}]` | `revision?`, `path?`, `include?`/`exclude?` build commit ranges. Uses an opaque cursor for pagination (take `page` from `next`). |
| `commits_get` | `GET .../commit/{hash}` | One commit: message, author, date, parents. |
| `diff_get` | `GET .../diff/{spec}` or `.../diffstat/{spec}` | `spec` is a hash or `source..destination`. Raw patch by default; `diffstat: true` returns a JSON per-file summary. |
| `src_read` | `GET .../src/{commit}/{path}` | Reads a file or lists a directory (empty `path` = repo root). Truncates file content at `max_bytes` (default 200000). |

### Pull requests — read

| Tool | Endpoint | Notes |
|---|---|---|
| `prs_list` | `GET .../pullrequests` | Defaults to `OPEN` when `state` is omitted; pass multiple states to combine. |
| `prs_get` | `GET .../pullrequests/{id}` | One pull request: state, branches, author, reviewers, approvals. |
| `prs_diff` | `GET .../pullrequests/{id}/diff` or `/diffstat` | Raw patch by default; `diffstat: true` for a JSON per-file summary. |
| `prs_commits` | `GET .../pullrequests/{id}/commits` | Commits included in the pull request. |
| `prs_comments_list` | `GET .../pullrequests/{id}/comments` | Comments, including inline (`inline.path`/`inline.to`) and replies (`parent.id`). |
| `prs_activity` | `GET .../pullrequests/{id}/activity` | Timeline: approvals, changes requested, updates, comments. |
| `prs_statuses` | `GET .../pullrequests/{id}/statuses` | Commit/build statuses (pipelines, CI) on the source commit. |

### Pull requests — write

| Tool | Endpoint | Notes |
|---|---|---|
| `prs_create` | `POST .../pullrequests` | `title`, `source_branch`, `destination_branch?` (defaults to main branch), `description?`, `reviewers?` (UUIDs), `close_source_branch?`, `draft?`. |
| `prs_update` | `PUT .../pullrequests/{id}` | Same fields as `prs_create`; only given fields change. |
| `prs_comment_create` | `POST .../pullrequests/{id}/comments` | Markdown `content`; `parent_id?` to reply, `inline?` (`path`, `to`/`from`) for line comments. |
| `prs_approve` | `POST .../pullrequests/{id}/approve` | Approve as the authenticated user/token. |
| `prs_unapprove` | `DELETE .../pullrequests/{id}/approve` | Withdraw the authenticated user's approval. |
| `prs_request_changes` | `POST`/`DELETE .../pullrequests/{id}/request-changes` | Mark "changes requested"; `revoke: true` to remove it. |
| `prs_merge` | `POST .../pullrequests/{id}/merge` | `merge_strategy?` (`merge_commit`\|`squash`\|`fast_forward`), `message?`, `close_source_branch?`. |
| `prs_decline` | `POST .../pullrequests/{id}/decline` | Decline (close without merging) an open pull request. |

### Pipelines (read)

| Tool | Endpoint | Notes |
|---|---|---|
| `pipelines_list` | `GET .../pipelines` | Newest first by default (`-created_on`). `target_branch?` filters by branch. |
| `pipelines_get` | `GET .../pipelines/{uuid}` | One pipeline run: state, result, trigger, target, duration. |
| `pipelines_steps_list` | `GET .../pipelines/{uuid}/steps` | Steps with state/result and `uuid` (needed for `pipelines_step_log`). |
| `pipelines_step_log` | `GET .../pipelines/{uuid}/steps/{step_uuid}/log` | Raw log, last `tail_lines` lines (default 300); header notes when truncated. |

## Tips for agents

- Responses omit `links` by default. Pass `fields` (e.g. `values.id,values.title,values.state`) to shrink big lists further.
- Paginated responses include `next`; pass `page` to continue. Commits use an opaque cursor — take `page` from the `next` URL.
- `diff_get`/`prs_diff` return raw patches; use `diffstat: true` for a quick per-file summary first.
- `src_read` with an empty `path` lists the repository root.

## Example prompts

- "List open PRs in south-console targeting master and summarize each diff."
- "Read `src/config.ts` from branch feature/x in repo south-crm-app."
- "Why did the last pipeline on master in south-website fail? Show the failing step's log."
- "Approve PR 42 in south-console and merge it with squash, closing the source branch."

## Development

```bash
npm install
npm test
npm run build && npm run list-tools           # spawns the server, lists 30 tools
set -a; source .env; set +a; npm run smoke    # real API call: user + 5 repos
```

## Roadmap

- v0.2 — pipelines write (trigger, stop), pipeline variables
- v0.3 — webhooks, branch restrictions, permissions, project/repo admin

## License

MIT
