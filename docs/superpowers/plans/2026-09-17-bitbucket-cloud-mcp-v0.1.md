# bitbucket-cloud-mcp v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an MCP server (STDIO, npm package `bitbucket-cloud-mcp`) exposing 30 tools over the Bitbucket Cloud REST API 2.0: account/workspace, repositories, code, pull requests (read + write) and pipelines (read).

**Architecture:** `src/index.ts` loads config → builds one `BitbucketClient` (native `fetch`, Bearer or Basic auth, default `fields=-links,-values.links`) → registers tool groups from `src/tools/*.ts` on an `McpServer` → connects STDIO. Every tool is built with `defineTool()` which wraps the handler in try/catch and maps errors to MCP `isError` responses with a scope hint.

**Tech Stack:** TypeScript 5 (strict, ESM, Node16 module resolution), `@modelcontextprotocol/sdk` ^1, `zod` ^3.25, `vitest` ^1, Node >= 18. Mirrors the sibling project `../runrun-mcp`.

**Spec:** `docs/superpowers/specs/2026-09-17-bitbucket-cloud-mcp-v0.1-design.md`

## Global Constraints

- Package name and bin: `bitbucket-cloud-mcp`; version `0.1.0`; license MIT.
- `engines.node >= 18`; ESM (`"type": "module"`); imports use `.js` extension.
- Base URL default `https://api.bitbucket.org/2.0`; override via `BITBUCKET_BASE_URL`.
- Auth: `BITBUCKET_ACCESS_TOKEN` → `Authorization: Bearer <token>`; else `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN` → `Authorization: Basic base64(email:token)`. Bearer wins if both set (with a warning). No credentials → exit code 1 at boot.
- `BITBUCKET_WORKSPACE` optional default; tools accept `workspace?`.
- JSON `get` injects `fields=-links,-values.links` unless caller passes `fields`. Raw/text requests never inject `fields`.
- Pagination inputs: `page?` (number | string), `pagelen?` (1–100, default 25). Paginated responses returned unchanged.
- Tool naming `recurso_acao` (e.g. `prs_merge`). Every tool declares a `scopeHint` used in 403 messages.
- Logs go to stderr only. stdout is the MCP channel.
- Tests: vitest, `fetch` mocked, no real network. Commit after each task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` as the last line.
- All code, identifiers, tool names and tool descriptions in English (agent-facing). Plan/spec prose in Portuguese.

---

## File map

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `LICENSE` | Project scaffold |
| `src/logger.ts` | stderr logger with levels |
| `src/config.ts` | `loadConfig(env)` → `Config` (auth mode, workspace, baseUrl, timeout, logLevel, warnings) |
| `src/errors.ts` | `BitbucketApiError`, `ConfigError`, `parseErrorBody`, MCP response helpers |
| `src/pagination.ts` | `paginationFields`, `paginationParams`, defaults |
| `src/client.ts` | `BitbucketClient` (get/getRaw/getText/post/put/delete/resolveWorkspace), `seg`, `encodePath`, `DEFAULT_FIELDS` |
| `src/tools/types.ts` | `ToolDefinition` |
| `src/tools/register.ts` | `registerTools(server, tools)` |
| `src/tools/common.ts` | shared zod fields, `repoPath`, `compact`, `truncateBytes`, `tailLines`, `defineTool` |
| `src/tools/account.ts` | `user_me`, `workspaces_list`, `projects_list` |
| `src/tools/repos.ts` | `repos_list`, `repos_get`, `branches_list`, `tags_list` |
| `src/tools/code.ts` | `commits_list`, `commits_get`, `diff_get`, `src_read` |
| `src/tools/pullrequests.ts` | 15 `prs_*` tools |
| `src/tools/pipelines.ts` | 4 `pipelines_*` tools |
| `src/tools/index.ts` | `registerAllTools(server, client)` |
| `src/index.ts` | bootstrap |
| `scripts/smoke.mjs`, `scripts/list-tools.mjs` | manual checks (not in CI) |
| `tests/helpers.ts` | `baseConfig`, `mockResponse`, `installFetch`, `lastCall` |
| `tests/**/*.test.ts` | one test file per src module |
| `README.md` | multi-client install, credentials, scopes, tool table |

---

### Task 1: Project scaffold + logger

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `LICENSE`, `src/logger.ts`, `src/index.ts` (placeholder), `tests/logger.test.ts`

**Interfaces:**
- Produces: `createLogger(level: LogLevel): Logger`, `type LogLevel = "debug" | "info" | "warn" | "error"`, `interface Logger { debug, info, warn, error }`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "bitbucket-cloud-mcp",
  "version": "0.1.0",
  "description": "MCP server for the Bitbucket Cloud REST API: repositories, code, pull requests and pipelines, usable from Claude and other MCP clients.",
  "license": "MIT",
  "type": "module",
  "bin": {
    "bitbucket-cloud-mcp": "dist/index.js"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc",
    "postbuild": "chmod +x dist/index.js",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "smoke": "node scripts/smoke.mjs",
    "list-tools": "node scripts/list-tools.mjs",
    "prepublishOnly": "npm run build && npm test"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": false,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests", "scripts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"]
    }
  }
});
```

- [ ] **Step 4: Create `.env.example`**

```bash
# Option A — Atlassian API token (personal). Create at https://id.atlassian.com/manage-profile/security/api-tokens
# Choose "API token with scopes", product Bitbucket, and select the scopes listed in README.
BITBUCKET_EMAIL=
BITBUCKET_API_TOKEN=

# Option B — Workspace / project / repository access token (Bearer). If set, wins over option A.
# BITBUCKET_ACCESS_TOKEN=

# Optional — default workspace slug used when a tool call omits `workspace`
BITBUCKET_WORKSPACE=

# Optional — defaults shown
# BITBUCKET_BASE_URL=https://api.bitbucket.org/2.0
# BITBUCKET_TIMEOUT_MS=30000
# LOG_LEVEL=info
```

- [ ] **Step 5: Create `LICENSE`**

Copy `../runrun-mcp/LICENSE` (MIT). Set the copyright line to `Copyright (c) 2026 South TI`.

```bash
cp ../runrun-mcp/LICENSE LICENSE && sed -i '' 's/^Copyright (c) .*/Copyright (c) 2026 South TI/' LICENSE && head -3 LICENSE
```

- [ ] **Step 6: Create `src/logger.ts`**

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function createLogger(level: LogLevel): Logger {
  const threshold = LEVEL_ORDER[level];

  const log = (lvl: LogLevel, msg: string) => {
    if (LEVEL_ORDER[lvl] < threshold) return;
    const ts = new Date().toISOString();
    process.stderr.write(`[${ts}] [${lvl}] ${msg}\n`);
  };

  return {
    debug: (m) => log("debug", m),
    info: (m) => log("info", m),
    warn: (m) => log("warn", m),
    error: (m) => log("error", m)
  };
}
```

- [ ] **Step 7: Create placeholder `src/index.ts`** (replaced in Task 13)

```ts
#!/usr/bin/env node
process.stderr.write("bitbucket-cloud-mcp: not wired yet\n");
```

- [ ] **Step 8: Write `tests/logger.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes messages at or above the threshold to stderr", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger("warn");
    logger.info("hidden");
    logger.warn("shown");
    logger.error("also shown");
    expect(write).toHaveBeenCalledTimes(2);
    expect(String(write.mock.calls[0][0])).toContain("[warn] shown");
    expect(String(write.mock.calls[1][0])).toContain("[error] also shown");
  });

  it("never writes to stdout", () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    createLogger("debug").debug("x");
    expect(out).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 9: Install and run**

Run: `npm install && npm run build && npm test`
Expected: install ok, `dist/index.js` created, 2 tests pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold bitbucket-cloud-mcp (package, tsconfig, vitest, logger)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Config loading

**Files:**
- Create: `src/config.ts`, `tests/config.test.ts`

**Interfaces:**
- Consumes: `LogLevel` from `src/logger.ts`.
- Produces:
  ```ts
  type AuthConfig = { mode: "bearer"; token: string } | { mode: "basic"; email: string; token: string };
  interface Config { auth: AuthConfig; workspace?: string; baseUrl: string; timeoutMs: number; logLevel: LogLevel; warnings: string[] }
  function loadConfig(env?: NodeJS.ProcessEnv): Config   // throws Error with actionable message
  const DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS
  ```

- [ ] **Step 1: Write `tests/config.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { loadConfig, DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS } from "../src/config.js";

describe("loadConfig", () => {
  it("uses bearer mode with BITBUCKET_ACCESS_TOKEN", () => {
    const cfg = loadConfig({ BITBUCKET_ACCESS_TOKEN: "tok" });
    expect(cfg.auth).toEqual({ mode: "bearer", token: "tok" });
    expect(cfg.warnings).toEqual([]);
  });

  it("uses basic mode with email + api token", () => {
    const cfg = loadConfig({ BITBUCKET_EMAIL: "a@b.com", BITBUCKET_API_TOKEN: "t" });
    expect(cfg.auth).toEqual({ mode: "basic", email: "a@b.com", token: "t" });
  });

  it("prefers bearer when both are set and records a warning", () => {
    const cfg = loadConfig({
      BITBUCKET_ACCESS_TOKEN: "tok",
      BITBUCKET_EMAIL: "a@b.com",
      BITBUCKET_API_TOKEN: "t"
    });
    expect(cfg.auth.mode).toBe("bearer");
    expect(cfg.warnings[0]).toMatch(/using the access token/i);
  });

  it("fails when email is set without api token", () => {
    expect(() => loadConfig({ BITBUCKET_EMAIL: "a@b.com" })).toThrow(/BITBUCKET_API_TOKEN is missing/);
  });

  it("fails when api token is set without email", () => {
    expect(() => loadConfig({ BITBUCKET_API_TOKEN: "t" })).toThrow(/BITBUCKET_EMAIL is missing/);
  });

  it("fails with both options described when no credentials", () => {
    expect(() => loadConfig({})).toThrow(/BITBUCKET_ACCESS_TOKEN.*BITBUCKET_EMAIL \+ BITBUCKET_API_TOKEN/s);
  });

  it("treats blank values as unset", () => {
    expect(() => loadConfig({ BITBUCKET_ACCESS_TOKEN: "   " })).toThrow(/Missing credentials/);
  });

  it("applies defaults", () => {
    const cfg = loadConfig({ BITBUCKET_ACCESS_TOKEN: "tok" });
    expect(cfg.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(cfg.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(cfg.logLevel).toBe("info");
    expect(cfg.workspace).toBeUndefined();
  });

  it("reads optional overrides", () => {
    const cfg = loadConfig({
      BITBUCKET_ACCESS_TOKEN: "tok",
      BITBUCKET_WORKSPACE: "southti",
      BITBUCKET_BASE_URL: "https://proxy.local/2.0",
      BITBUCKET_TIMEOUT_MS: "5000",
      LOG_LEVEL: "debug"
    });
    expect(cfg.workspace).toBe("southti");
    expect(cfg.baseUrl).toBe("https://proxy.local/2.0");
    expect(cfg.timeoutMs).toBe(5000);
    expect(cfg.logLevel).toBe("debug");
  });

  it("rejects invalid LOG_LEVEL naming the env var", () => {
    expect(() => loadConfig({ BITBUCKET_ACCESS_TOKEN: "tok", LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });

  it("rejects non-numeric BITBUCKET_TIMEOUT_MS", () => {
    expect(() => loadConfig({ BITBUCKET_ACCESS_TOKEN: "tok", BITBUCKET_TIMEOUT_MS: "abc" })).toThrow(/BITBUCKET_TIMEOUT_MS/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL, cannot find module `../src/config.js`.

- [ ] **Step 3: Create `src/config.ts`**

```ts
import { z } from "zod";
import type { LogLevel } from "./logger.js";

export type AuthConfig =
  | { mode: "bearer"; token: string }
  | { mode: "basic"; email: string; token: string };

export interface Config {
  auth: AuthConfig;
  workspace?: string;
  baseUrl: string;
  timeoutMs: number;
  logLevel: LogLevel;
  warnings: string[];
}

export const DEFAULT_BASE_URL = "https://api.bitbucket.org/2.0";
export const DEFAULT_TIMEOUT_MS = 30_000;

const OptionalSchema = z.object({
  baseUrl: z.string().url(),
  timeoutMs: z.number().int().positive(),
  logLevel: z.enum(["debug", "info", "warn", "error"])
});

const ENV_NAMES: Record<string, string> = {
  baseUrl: "BITBUCKET_BASE_URL",
  timeoutMs: "BITBUCKET_TIMEOUT_MS",
  logLevel: "LOG_LEVEL"
};

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const warnings: string[] = [];
  const accessToken = nonEmpty(env.BITBUCKET_ACCESS_TOKEN);
  const email = nonEmpty(env.BITBUCKET_EMAIL);
  const apiToken = nonEmpty(env.BITBUCKET_API_TOKEN);

  let auth: AuthConfig;
  if (accessToken) {
    auth = { mode: "bearer", token: accessToken };
    if (email || apiToken) {
      warnings.push(
        "Both BITBUCKET_ACCESS_TOKEN and BITBUCKET_EMAIL/BITBUCKET_API_TOKEN are set; using the access token (Bearer)."
      );
    }
  } else if (email && apiToken) {
    auth = { mode: "basic", email, token: apiToken };
  } else if (email) {
    throw new Error("BITBUCKET_EMAIL is set but BITBUCKET_API_TOKEN is missing.");
  } else if (apiToken) {
    throw new Error("BITBUCKET_API_TOKEN is set but BITBUCKET_EMAIL is missing.");
  } else {
    throw new Error(
      "Missing credentials. Set BITBUCKET_ACCESS_TOKEN (workspace/project/repository access token) " +
        "or BITBUCKET_EMAIL + BITBUCKET_API_TOKEN (Atlassian API token)."
    );
  }

  const rawTimeout = nonEmpty(env.BITBUCKET_TIMEOUT_MS);
  const parsed = OptionalSchema.safeParse({
    baseUrl: nonEmpty(env.BITBUCKET_BASE_URL) ?? DEFAULT_BASE_URL,
    timeoutMs: rawTimeout === undefined ? DEFAULT_TIMEOUT_MS : Number(rawTimeout),
    logLevel: nonEmpty(env.LOG_LEVEL) ?? "info"
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = issue.path.join(".");
    throw new Error(`Invalid config (${ENV_NAMES[key] ?? key}): ${issue.message}`);
  }

  return {
    auth,
    workspace: nonEmpty(env.BITBUCKET_WORKSPACE),
    ...parsed.data,
    warnings
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/config.test.ts`
Expected: 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat(config): load bearer/basic auth, workspace and options from env

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Errors and MCP response helpers

**Files:**
- Create: `src/errors.ts`, `tests/errors.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type McpToolResponse = { content: { type: "text"; text: string }[]; isError?: boolean }
  class BitbucketApiError extends Error { status: number; endpoint: string; body: string; retryAfter?: number }  // ctor(status, endpoint, message, body, retryAfter?)
  class ConfigError extends Error
  function parseErrorBody(body: string): string
  function successResponse(data: unknown): McpToolResponse
  function textResponse(text: string): McpToolResponse
  function genericErrorResponse(err: unknown, scopeHint?: string): McpToolResponse
  ```

- [ ] **Step 1: Write `tests/errors.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  BitbucketApiError,
  ConfigError,
  parseErrorBody,
  successResponse,
  textResponse,
  genericErrorResponse
} from "../src/errors.js";

describe("parseErrorBody", () => {
  it("extracts error.message from Bitbucket error JSON", () => {
    const body = JSON.stringify({ type: "error", error: { message: "Repository not found" } });
    expect(parseErrorBody(body)).toBe("Repository not found");
  });

  it("appends detail when present", () => {
    const body = JSON.stringify({ type: "error", error: { message: "Bad request", detail: "title is required" } });
    expect(parseErrorBody(body)).toBe("Bad request (title is required)");
  });

  it("falls back to raw body for non-JSON", () => {
    expect(parseErrorBody("<html>gateway</html>")).toBe("<html>gateway</html>");
  });

  it("describes an empty body", () => {
    expect(parseErrorBody("")).toBe("(empty response body)");
  });
});

describe("successResponse / textResponse", () => {
  it("serializes JSON with indentation", () => {
    const r = successResponse({ a: 1 });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toBe('{\n  "a": 1\n}');
  });

  it("passes text through", () => {
    expect(textResponse("diff --git").content[0].text).toBe("diff --git");
  });
});

describe("genericErrorResponse", () => {
  const mk = (status: number, retryAfter?: number) =>
    new BitbucketApiError(status, "/repositories/x/y", "boom", "{}", retryAfter);

  it("401 explains credentials", () => {
    const r = genericErrorResponse(mk(401));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/401/);
    expect(r.content[0].text).toMatch(/BITBUCKET_ACCESS_TOKEN or BITBUCKET_EMAIL\/BITBUCKET_API_TOKEN/);
  });

  it("403 includes the scope hint", () => {
    const r = genericErrorResponse(mk(403), "pullrequest:write");
    expect(r.content[0].text).toMatch(/lacks the "pullrequest:write" scope/);
  });

  it("403 without hint still reports forbidden", () => {
    expect(genericErrorResponse(mk(403)).content[0].text).toMatch(/Forbidden \(403\)/);
  });

  it("404 reminds about case sensitivity", () => {
    expect(genericErrorResponse(mk(404)).content[0].text).toMatch(/case-sensitive/);
  });

  it("429 reports Retry-After when known", () => {
    expect(genericErrorResponse(mk(429, 42)).content[0].text).toMatch(/Wait 42s/);
    expect(genericErrorResponse(mk(429)).content[0].text).toMatch(/Retry later/);
  });

  it("other statuses show status, endpoint and message", () => {
    expect(genericErrorResponse(mk(500)).content[0].text).toBe(
      "Bitbucket API error (status 500) on /repositories/x/y: boom"
    );
  });

  it("maps ConfigError", () => {
    const r = genericErrorResponse(new ConfigError("No workspace given."));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Configuration error: No workspace given.");
  });

  it("maps plain errors and non-errors as network errors", () => {
    expect(genericErrorResponse(new Error("ECONNRESET")).content[0].text).toBe("Network error: ECONNRESET");
    expect(genericErrorResponse("weird").content[0].text).toBe("Network error: weird");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/errors.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/errors.ts`**

```ts
export type McpTextContent = { type: "text"; text: string };
export type McpToolResponse = { content: McpTextContent[]; isError?: boolean };

export class BitbucketApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    message: string,
    public readonly body: string,
    public readonly retryAfter?: number
  ) {
    super(message);
    this.name = "BitbucketApiError";
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Bitbucket error bodies look like `{ "type": "error", "error": { "message": "...", "detail": "..." } }`.
 * Returns `message (detail)` when available, otherwise the raw body.
 */
export function parseErrorBody(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: string; detail?: string } };
    const msg = json.error?.message;
    if (typeof msg === "string" && msg.length > 0) {
      const detail = json.error?.detail;
      return typeof detail === "string" && detail.length > 0 ? `${msg} (${detail})` : msg;
    }
  } catch {
    // not JSON
  }
  return body.trim() || "(empty response body)";
}

export function successResponse(data: unknown): McpToolResponse {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function textResponse(text: string): McpToolResponse {
  return { content: [{ type: "text", text }] };
}

function errorResponse(text: string): McpToolResponse {
  return { content: [{ type: "text", text }], isError: true };
}

export function apiErrorResponse(err: BitbucketApiError, scopeHint?: string): McpToolResponse {
  switch (err.status) {
    case 401:
      return errorResponse(
        `Not authenticated (401) on ${err.endpoint}: token is invalid or expired. ` +
          `Check BITBUCKET_ACCESS_TOKEN or BITBUCKET_EMAIL/BITBUCKET_API_TOKEN. Bitbucket said: ${err.message}`
      );
    case 403: {
      const hint = scopeHint ? ` The token probably lacks the "${scopeHint}" scope.` : "";
      return errorResponse(`Forbidden (403) on ${err.endpoint}.${hint} Bitbucket said: ${err.message}`);
    }
    case 404:
      return errorResponse(
        `Not found (404) on ${err.endpoint}. workspace and repo_slug are case-sensitive; ` +
          `also confirm the token has access to this repository. Bitbucket said: ${err.message}`
      );
    case 429: {
      const wait = err.retryAfter !== undefined ? ` Wait ${err.retryAfter}s and retry.` : " Retry later.";
      return errorResponse(`Rate limited (429) on ${err.endpoint}.${wait} Bitbucket said: ${err.message}`);
    }
    default:
      return errorResponse(`Bitbucket API error (status ${err.status}) on ${err.endpoint}: ${err.message}`);
  }
}

export function genericErrorResponse(err: unknown, scopeHint?: string): McpToolResponse {
  if (err instanceof BitbucketApiError) return apiErrorResponse(err, scopeHint);
  if (err instanceof ConfigError) return errorResponse(`Configuration error: ${err.message}`);
  if (err instanceof Error) return errorResponse(`Network error: ${err.message}`);
  return errorResponse(`Network error: ${String(err)}`);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/errors.test.ts`
Expected: 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts tests/errors.test.ts
git commit -m "feat(errors): Bitbucket error parsing and MCP response helpers with scope hints

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Pagination helpers

**Files:**
- Create: `src/pagination.ts`, `tests/pagination.test.ts`

**Interfaces:**
- Produces:
  ```ts
  const DEFAULT_PAGELEN = 25; const MAX_PAGELEN = 100;
  const paginationFields: { page: ZodOptional<...>; pagelen: ZodOptional<...> }
  type PaginationInput = { page?: number | string; pagelen?: number }
  function paginationParams(input: PaginationInput): { page?: number | string; pagelen: number }
  ```

- [ ] **Step 1: Write `tests/pagination.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { paginationFields, paginationParams, DEFAULT_PAGELEN } from "../src/pagination.js";

const schema = z.object(paginationFields);

describe("paginationFields", () => {
  it("accepts numeric and string page", () => {
    expect(schema.parse({ page: 3 }).page).toBe(3);
    expect(schema.parse({ page: "abc123" }).page).toBe("abc123");
  });

  it("rejects page 0 and empty string", () => {
    expect(schema.safeParse({ page: 0 }).success).toBe(false);
    expect(schema.safeParse({ page: "" }).success).toBe(false);
  });

  it("bounds pagelen to 1..100", () => {
    expect(schema.safeParse({ pagelen: 0 }).success).toBe(false);
    expect(schema.safeParse({ pagelen: 101 }).success).toBe(false);
    expect(schema.parse({ pagelen: 100 }).pagelen).toBe(100);
  });
});

describe("paginationParams", () => {
  it("applies default pagelen and leaves page undefined", () => {
    expect(paginationParams({})).toEqual({ page: undefined, pagelen: DEFAULT_PAGELEN });
  });

  it("passes through explicit values", () => {
    expect(paginationParams({ page: "cur", pagelen: 10 })).toEqual({ page: "cur", pagelen: 10 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/pagination.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/pagination.ts`**

```ts
import { z } from "zod";

export const DEFAULT_PAGELEN = 25;
export const MAX_PAGELEN = 100;

export const paginationFields = {
  page: z
    .union([z.number().int().min(1), z.string().min(1)])
    .optional()
    .describe(
      "Page to fetch. A number for most endpoints. Commits use an opaque cursor: pass the `page` value from the previous response's `next` URL."
    ),
  pagelen: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGELEN)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PAGELEN}, max ${MAX_PAGELEN}).`)
};

export type PaginationInput = { page?: number | string; pagelen?: number };

export function paginationParams(input: PaginationInput): { page?: number | string; pagelen: number } {
  return { page: input.page, pagelen: input.pagelen ?? DEFAULT_PAGELEN };
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/pagination.test.ts` — Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/pagination.ts tests/pagination.test.ts
git commit -m "feat(pagination): page/pagelen fields with cursor support

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Test helpers + HTTP client

**Files:**
- Create: `tests/helpers.ts`, `src/client.ts`, `tests/client.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 2); `BitbucketApiError`, `ConfigError`, `parseErrorBody` (Task 3).
- Produces:
  ```ts
  type QueryValue = string | number | boolean | string[] | undefined
  type QueryParams = Record<string, QueryValue>
  type BodyParams = Record<string, unknown>
  type RawResponse = { text: string; contentType: string }
  const DEFAULT_FIELDS = "-links,-values.links"
  function seg(value: string | number): string          // encodeURIComponent
  function encodePath(path: string): string             // encodes each "/" segment, keeps slashes
  class BitbucketClient {
    constructor(config: Config)
    resolveWorkspace(input?: string): string            // throws ConfigError
    get<T>(path, params?): Promise<T>                   // injects DEFAULT_FIELDS when params.fields undefined
    getRaw(path, params?): Promise<RawResponse>         // no fields injection
    getText(path, params?): Promise<string>
    post<T>(path, body?, params?): Promise<T>
    put<T>(path, body, params?): Promise<T>
    delete<T>(path, params?): Promise<T>
  }
  ```
  Test helpers: `baseConfig: Config` (bearer, workspace "southti"), `mockResponse({status?, body?, text?, headers?})`, `installFetch(...responses)` returns the `vi.fn()`, `lastCall(fn)` → `{ url: URL, init }`.

- [ ] **Step 1: Create `tests/helpers.ts`**

```ts
import { vi } from "vitest";
import type { Config } from "../src/config.js";

export const baseConfig: Config = {
  auth: { mode: "bearer", token: "tok" },
  workspace: "southti",
  baseUrl: "https://api.bitbucket.org/2.0",
  timeoutMs: 30_000,
  logLevel: "error",
  warnings: []
};

export const basicConfig: Config = {
  ...baseConfig,
  auth: { mode: "basic", email: "dev@south.com", token: "api-token" }
};

export type MockInit = {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
};

export function mockResponse(init: MockInit = {}) {
  const status = init.status ?? 200;
  const text = init.text ?? (init.body === undefined ? "" : JSON.stringify(init.body));
  const headers = new Headers(init.headers ?? { "content-type": "application/json" });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    text: async () => text,
    json: async () => JSON.parse(text)
  };
}

export function installFetch(...responses: ReturnType<typeof mockResponse>[]) {
  const fn = vi.fn();
  if (responses.length === 0) {
    fn.mockResolvedValue(mockResponse({ body: {} }));
  } else {
    for (const r of responses) fn.mockResolvedValueOnce(r);
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

export function lastCall(fn: ReturnType<typeof vi.fn>) {
  const call = fn.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return {
    url: new URL(call[0] as string),
    init: call[1] as RequestInit & { headers: Record<string, string> }
  };
}
```

- [ ] **Step 2: Write `tests/client.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { BitbucketClient, seg, encodePath, DEFAULT_FIELDS } from "../src/client.js";
import { BitbucketApiError, ConfigError } from "../src/errors.js";
import { baseConfig, basicConfig, installFetch, mockResponse, lastCall } from "./helpers.js";

describe("seg / encodePath", () => {
  it("encodes a single segment including slashes", () => {
    expect(seg("feature/x y")).toBe("feature%2Fx%20y");
    expect(seg(42)).toBe("42");
  });

  it("encodes each segment of a path but keeps slashes", () => {
    expect(encodePath("src/app/my file.ts")).toBe("src/app/my%20file.ts");
    expect(encodePath("/leading/")).toBe("leading");
    expect(encodePath("")).toBe("");
  });
});

describe("BitbucketClient auth headers", () => {
  it("sends Bearer for access tokens", async () => {
    const fetchMock = installFetch(mockResponse({ body: {} }));
    await new BitbucketClient(baseConfig).get("/user");
    expect(lastCall(fetchMock).init.headers.Authorization).toBe("Bearer tok");
  });

  it("sends Basic base64(email:token) for api tokens", async () => {
    const fetchMock = installFetch(mockResponse({ body: {} }));
    await new BitbucketClient(basicConfig).get("/user");
    const expected = "Basic " + Buffer.from("dev@south.com:api-token").toString("base64");
    expect(lastCall(fetchMock).init.headers.Authorization).toBe(expected);
  });
});

describe("BitbucketClient.get", () => {
  it("injects default fields and Accept json", async () => {
    const fetchMock = installFetch(mockResponse({ body: { ok: true } }));
    const data = await new BitbucketClient(baseConfig).get("/workspaces", { q: 'slug="x"' });
    const { url, init } = lastCall(fetchMock);
    expect(url.origin + url.pathname).toBe("https://api.bitbucket.org/2.0/workspaces");
    expect(url.searchParams.get("fields")).toBe(DEFAULT_FIELDS);
    expect(url.searchParams.get("q")).toBe('slug="x"');
    expect(init.method).toBe("GET");
    expect(init.headers.Accept).toBe("application/json");
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(data).toEqual({ ok: true });
  });

  it("respects caller-provided fields", async () => {
    const fetchMock = installFetch(mockResponse({ body: {} }));
    await new BitbucketClient(baseConfig).get("/workspaces", { fields: "values.slug" });
    expect(lastCall(fetchMock).url.searchParams.get("fields")).toBe("values.slug");
  });

  it("omits undefined params and repeats array params", async () => {
    const fetchMock = installFetch(mockResponse({ body: {} }));
    await new BitbucketClient(baseConfig).get("/x", { a: undefined, state: ["OPEN", "MERGED"], n: 2, b: true });
    const { url } = lastCall(fetchMock);
    expect(url.searchParams.has("a")).toBe(false);
    expect(url.searchParams.getAll("state")).toEqual(["OPEN", "MERGED"]);
    expect(url.searchParams.get("n")).toBe("2");
    expect(url.searchParams.get("b")).toBe("true");
  });

  it("strips trailing slash from baseUrl", async () => {
    const fetchMock = installFetch(mockResponse({ body: {} }));
    await new BitbucketClient({ ...baseConfig, baseUrl: "https://api.bitbucket.org/2.0/" }).get("/user");
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/user");
  });

  it("returns {} on 204 and on empty body", async () => {
    installFetch(mockResponse({ status: 204 }), mockResponse({ status: 200, text: "" }));
    const client = new BitbucketClient(baseConfig);
    expect(await client.get("/a")).toEqual({});
    expect(await client.get("/b")).toEqual({});
  });

  it("throws BitbucketApiError with parsed message and Retry-After", async () => {
    installFetch(
      mockResponse({
        status: 429,
        body: { type: "error", error: { message: "Rate limit exceeded" } },
        headers: { "content-type": "application/json", "retry-after": "17" }
      })
    );
    const err = await new BitbucketClient(baseConfig).get("/repositories/southti").catch((e) => e);
    expect(err).toBeInstanceOf(BitbucketApiError);
    expect(err.status).toBe(429);
    expect(err.endpoint).toBe("/repositories/southti");
    expect(err.message).toBe("Rate limit exceeded");
    expect(err.retryAfter).toBe(17);
    expect(err.body).toContain("Rate limit exceeded");
  });

  it("converts timeout aborts into a network error", async () => {
    const abort = new Error("aborted");
    abort.name = "TimeoutError";
    global.fetch = (async () => {
      throw abort;
    }) as unknown as typeof fetch;
    await expect(new BitbucketClient({ ...baseConfig, timeoutMs: 5 }).get("/user")).rejects.toThrow(
      /timeout after 5ms on GET \/user/
    );
  });

  it("passes an AbortSignal", async () => {
    const fetchMock = installFetch(mockResponse({ body: {} }));
    await new BitbucketClient(baseConfig).get("/user");
    expect(lastCall(fetchMock).init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("BitbucketClient.getRaw / getText", () => {
  it("does not inject fields, asks for text and returns content type", async () => {
    const fetchMock = installFetch(
      mockResponse({ text: "diff --git a b", headers: { "content-type": "text/plain; charset=utf-8" } })
    );
    const raw = await new BitbucketClient(baseConfig).getRaw("/repositories/w/r/diff/a..b", { context: 3 });
    const { url, init } = lastCall(fetchMock);
    expect(url.searchParams.has("fields")).toBe(false);
    expect(url.searchParams.get("context")).toBe("3");
    expect(init.headers.Accept).toMatch(/^text\/plain/);
    expect(init.redirect).toBe("follow");
    expect(raw).toEqual({ text: "diff --git a b", contentType: "text/plain" });
  });

  it("getText returns only the text", async () => {
    installFetch(mockResponse({ text: "hello", headers: { "content-type": "text/plain" } }));
    expect(await new BitbucketClient(baseConfig).getText("/x")).toBe("hello");
  });

  it("throws BitbucketApiError on non-2xx", async () => {
    installFetch(mockResponse({ status: 404, body: { error: { message: "nope" } } }));
    await expect(new BitbucketClient(baseConfig).getText("/x")).rejects.toMatchObject({ status: 404, message: "nope" });
  });
});

describe("BitbucketClient write methods", () => {
  it("post sends JSON body with Content-Type", async () => {
    const fetchMock = installFetch(mockResponse({ body: { id: 1 } }));
    const out = await new BitbucketClient(baseConfig).post("/repositories/w/r/pullrequests", { title: "t" });
    const { init } = lastCall(fetchMock);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"title":"t"}');
    expect(out).toEqual({ id: 1 });
  });

  it("post without body sends no Content-Type and no body", async () => {
    const fetchMock = installFetch(mockResponse({ body: {} }));
    await new BitbucketClient(baseConfig).post("/repositories/w/r/pullrequests/1/approve");
    const { init } = lastCall(fetchMock);
    expect(init.body).toBeUndefined();
    expect(init.headers["Content-Type"]).toBeUndefined();
  });

  it("put and delete use the right methods", async () => {
    const fetchMock = installFetch(mockResponse({ body: {} }), mockResponse({ status: 204 }));
    const client = new BitbucketClient(baseConfig);
    await client.put("/a", { x: 1 });
    expect(lastCall(fetchMock).init.method).toBe("PUT");
    await client.delete("/a");
    expect(lastCall(fetchMock).init.method).toBe("DELETE");
  });
});

describe("BitbucketClient.resolveWorkspace", () => {
  it("prefers the explicit input", () => {
    expect(new BitbucketClient(baseConfig).resolveWorkspace("other")).toBe("other");
  });

  it("falls back to config", () => {
    expect(new BitbucketClient(baseConfig).resolveWorkspace(undefined)).toBe("southti");
    expect(new BitbucketClient(baseConfig).resolveWorkspace("  ")).toBe("southti");
  });

  it("throws ConfigError when neither exists", () => {
    const client = new BitbucketClient({ ...baseConfig, workspace: undefined });
    expect(() => client.resolveWorkspace()).toThrow(ConfigError);
    expect(() => client.resolveWorkspace()).toThrow(/BITBUCKET_WORKSPACE/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/client.test.ts` — Expected: FAIL, module `../src/client.js` not found.

- [ ] **Step 4: Create `src/client.ts`**

```ts
import type { Config } from "./config.js";
import { BitbucketApiError, ConfigError, parseErrorBody } from "./errors.js";

export type QueryValue = string | number | boolean | string[] | undefined;
export type QueryParams = Record<string, QueryValue>;
export type BodyParams = Record<string, unknown>;
export type RawResponse = { text: string; contentType: string };

/** Default partial-response selector: drops the bulky `links` blocks from objects and list items. */
export const DEFAULT_FIELDS = "-links,-values.links";

const JSON_ACCEPT = "application/json";
const TEXT_ACCEPT = "text/plain, application/json;q=0.9, */*;q=0.8";

/** URL-encode one path segment (repo slug, branch name, UUID, hash...). */
export function seg(value: string | number): string {
  return encodeURIComponent(String(value));
}

/** URL-encode a slash-separated file path, keeping the slashes. */
export function encodePath(path: string): string {
  return path
    .split("/")
    .filter((s) => s.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

export class BitbucketClient {
  constructor(private readonly config: Config) {}

  resolveWorkspace(input?: string): string {
    const ws = input?.trim() || this.config.workspace;
    if (!ws) {
      throw new ConfigError("No workspace given. Pass `workspace` or set BITBUCKET_WORKSPACE.");
    }
    return ws;
  }

  async get<T = unknown>(path: string, params: QueryParams = {}): Promise<T> {
    const withFields = params.fields === undefined ? { ...params, fields: DEFAULT_FIELDS } : params;
    const res = await this.request("GET", path, withFields, undefined, JSON_ACCEPT);
    return this.parseJson<T>(res, path);
  }

  async getRaw(path: string, params: QueryParams = {}): Promise<RawResponse> {
    const res = await this.request("GET", path, params, undefined, TEXT_ACCEPT);
    await this.assertOk(res, path);
    const rawType = res.headers.get("content-type") ?? "text/plain";
    const contentType = rawType.split(";")[0].trim().toLowerCase();
    return { text: await res.text(), contentType };
  }

  async getText(path: string, params: QueryParams = {}): Promise<string> {
    return (await this.getRaw(path, params)).text;
  }

  async post<T = unknown>(path: string, body?: BodyParams, params: QueryParams = {}): Promise<T> {
    const res = await this.request("POST", path, params, body, JSON_ACCEPT);
    return this.parseJson<T>(res, path);
  }

  async put<T = unknown>(path: string, body: BodyParams, params: QueryParams = {}): Promise<T> {
    const res = await this.request("PUT", path, params, body, JSON_ACCEPT);
    return this.parseJson<T>(res, path);
  }

  async delete<T = unknown>(path: string, params: QueryParams = {}): Promise<T> {
    const res = await this.request("DELETE", path, params, undefined, JSON_ACCEPT);
    return this.parseJson<T>(res, path);
  }

  private async request(
    method: string,
    path: string,
    params: QueryParams,
    body: BodyParams | undefined,
    accept: string
  ): Promise<Response> {
    const url = this.buildUrl(path, params);
    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
      Accept: accept
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    try {
      return await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "follow",
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        throw new Error(`timeout after ${this.config.timeoutMs}ms on ${method} ${path}`);
      }
      throw err;
    }
  }

  private authHeader(): string {
    const { auth } = this.config;
    if (auth.mode === "bearer") return `Bearer ${auth.token}`;
    const encoded = Buffer.from(`${auth.email}:${auth.token}`, "utf8").toString("base64");
    return `Basic ${encoded}`;
  }

  private async assertOk(res: Response, path: string): Promise<void> {
    if (res.ok) return;
    const body = await res.text();
    const retryHeader = res.headers.get("retry-after");
    const retryAfter = retryHeader !== null && /^\d+$/.test(retryHeader) ? Number(retryHeader) : undefined;
    throw new BitbucketApiError(res.status, path, parseErrorBody(body), body, retryAfter);
  }

  private async parseJson<T>(res: Response, path: string): Promise<T> {
    await this.assertOk(res, path);
    if (res.status === 204) return {} as T;
    const text = await res.text();
    if (text.length === 0) return {} as T;
    return JSON.parse(text) as T;
  }

  private buildUrl(path: string, params: QueryParams): string {
    const url = new URL(this.config.baseUrl.replace(/\/$/, "") + path);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, v);
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}
```

- [ ] **Step 5: Run tests** — `npx vitest run tests/client.test.ts` — Expected: 20 pass.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers.ts src/client.ts tests/client.test.ts
git commit -m "feat(client): fetch-based Bitbucket client with bearer/basic auth, default fields and raw text

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Tool plumbing — types, register, common helpers

**Files:**
- Create: `src/tools/types.ts`, `src/tools/register.ts`, `src/tools/common.ts`, `tests/tools/common.test.ts`

**Interfaces:**
- Consumes: `BitbucketClient`, `seg` (Task 5); `genericErrorResponse`, `McpToolResponse` (Task 3).
- Produces:
  ```ts
  interface ToolDefinition { name: string; config: { title; description; inputSchema?: ZodRawShape }; handler: (input: any) => Promise<McpToolResponse>; scopeHint: string }
  function registerTools(server: McpServer, tools: ToolDefinition[]): void
  const workspaceField, repoFields, fieldsField, filterFields   // zod raw shapes to spread into inputSchema
  type RepoInput = { workspace?: string; repo_slug: string }
  function repoPath(client, input: RepoInput): string          // "/repositories/{ws}/{repo_slug}" encoded
  function compact<T extends Record<string, unknown>>(obj: T): Partial<T>   // drops undefined values
  function truncateBytes(text: string, maxBytes: number): string
  function tailLines(text: string, n: number): string
  function defineTool<S extends ZodRawShape>(def: { name; title; description; scopeHint; inputSchema: S; handler: (input: z.infer<z.ZodObject<S>>) => Promise<McpToolResponse> }): ToolDefinition
  ```

- [ ] **Step 1: Write `tests/tools/common.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { BitbucketClient } from "../../src/client.js";
import { BitbucketApiError, ConfigError } from "../../src/errors.js";
import { repoPath, compact, truncateBytes, tailLines, defineTool, repoFields } from "../../src/tools/common.js";
import { baseConfig } from "../helpers.js";

describe("repoPath", () => {
  it("encodes workspace and slug and uses the default workspace", () => {
    const client = new BitbucketClient(baseConfig);
    expect(repoPath(client, { repo_slug: "my repo" })).toBe("/repositories/southti/my%20repo");
    expect(repoPath(client, { workspace: "Other", repo_slug: "r" })).toBe("/repositories/Other/r");
  });
});

describe("compact", () => {
  it("drops undefined values only", () => {
    expect(compact({ a: 1, b: undefined, c: null, d: "" })).toEqual({ a: 1, c: null, d: "" });
  });
});

describe("truncateBytes", () => {
  it("returns text unchanged when within limit", () => {
    expect(truncateBytes("abc", 3)).toBe("abc");
  });

  it("truncates and appends a notice with sizes", () => {
    const out = truncateBytes("abcdefghij", 4);
    expect(out.startsWith("abcd")).toBe(true);
    expect(out).toContain("[truncated: showing 4 of 10 bytes]");
  });

  it("does not leave a broken multibyte char", () => {
    const out = truncateBytes("ééé", 3); // each é = 2 bytes
    expect(out.startsWith("é")).toBe(true);
    expect(out).not.toContain("�");
  });
});

describe("tailLines", () => {
  it("returns text unchanged when short enough", () => {
    expect(tailLines("a\nb", 5)).toBe("a\nb");
  });

  it("keeps the last n lines with a header", () => {
    expect(tailLines("1\n2\n3\n4", 2)).toBe("[showing last 2 of 4 lines]\n3\n4");
  });
});

describe("defineTool", () => {
  const schema = { ...repoFields, n: z.number() };

  it("builds a ToolDefinition and passes input through", async () => {
    const tool = defineTool({
      name: "demo_tool",
      title: "Demo",
      description: "d",
      scopeHint: "repository",
      inputSchema: schema,
      handler: async (input) => ({ content: [{ type: "text", text: `n=${input.n}` }] })
    });
    expect(tool.name).toBe("demo_tool");
    expect(tool.scopeHint).toBe("repository");
    expect(tool.config.inputSchema).toBe(schema);
    const res = await tool.handler({ repo_slug: "r", n: 2 });
    expect(res.content[0].text).toBe("n=2");
  });

  it("maps thrown API errors with the scope hint", async () => {
    const tool = defineTool({
      name: "x",
      title: "x",
      description: "x",
      scopeHint: "pullrequest:write",
      inputSchema: {},
      handler: async () => {
        throw new BitbucketApiError(403, "/p", "no", "{}");
      }
    });
    const res = await tool.handler({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('"pullrequest:write"');
  });

  it("maps ConfigError", async () => {
    const tool = defineTool({
      name: "x",
      title: "x",
      description: "x",
      scopeHint: "repository",
      inputSchema: {},
      handler: async () => {
        throw new ConfigError("No workspace given.");
      }
    });
    expect((await tool.handler({})).content[0].text).toMatch(/Configuration error/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/tools/common.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/tools/types.ts`**

```ts
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
```

- [ ] **Step 4: Create `src/tools/register.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDefinition } from "./types.js";

export function registerTools(server: McpServer, tools: ToolDefinition[]): void {
  for (const tool of tools) {
    server.registerTool(tool.name, tool.config, tool.handler);
  }
}
```

- [ ] **Step 5: Create `src/tools/common.ts`**

```ts
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
```

- [ ] **Step 6: Run tests and typecheck** — `npx vitest run tests/tools/common.test.ts && npx tsc --noEmit` — Expected: 10 pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/tools tests/tools
git commit -m "feat(tools): ToolDefinition, registerTools and shared helpers (defineTool, repoPath, truncation)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Account tools (`user_me`, `workspaces_list`, `projects_list`)

**Files:**
- Create: `src/tools/account.ts`, `tests/tools/account.test.ts`

**Interfaces:**
- Consumes: `defineTool`, `workspaceField`, `fieldsField`, `filterFields` (Task 6); `paginationFields`, `paginationParams` (Task 4); `BitbucketClient`, `seg` (Task 5); `successResponse` (Task 3).
- Produces: `createAccountTools(client: BitbucketClient): ToolDefinition[]`.

- [ ] **Step 1: Write `tests/tools/account.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { BitbucketClient } from "../../src/client.js";
import { createAccountTools } from "../../src/tools/account.js";
import { baseConfig, installFetch, mockResponse, lastCall } from "../helpers.js";

function tool(name: string) {
  const t = createAccountTools(new BitbucketClient(baseConfig)).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

describe("account tools", () => {
  it("exposes the three tools with scope hints", () => {
    const tools = createAccountTools(new BitbucketClient(baseConfig));
    expect(tools.map((t) => t.name)).toEqual(["user_me", "workspaces_list", "projects_list"]);
    expect(tools.map((t) => t.scopeHint)).toEqual(["account", "account", "project"]);
  });

  it("user_me calls GET /user", async () => {
    const fetchMock = installFetch(mockResponse({ body: { nickname: "thiago" } }));
    const res = await tool("user_me").handler({});
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/2.0/user");
    expect(url.searchParams.get("fields")).toBe("-links,-values.links");
    expect(JSON.parse(res.content[0].text)).toEqual({ nickname: "thiago" });
  });

  it("workspaces_list passes q, sort, fields and pagination", async () => {
    const fetchMock = installFetch(mockResponse({ body: { values: [] } }));
    await tool("workspaces_list").handler({ q: 'slug="southti"', sort: "name", fields: "values.slug", page: 2, pagelen: 10 });
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/2.0/workspaces");
    expect(url.searchParams.get("q")).toBe('slug="southti"');
    expect(url.searchParams.get("sort")).toBe("name");
    expect(url.searchParams.get("fields")).toBe("values.slug");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("pagelen")).toBe("10");
  });

  it("projects_list uses the default workspace and default pagelen", async () => {
    const fetchMock = installFetch(mockResponse({ body: { values: [] } }));
    await tool("projects_list").handler({});
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/2.0/workspaces/southti/projects");
    expect(url.searchParams.get("pagelen")).toBe("25");
  });

  it("projects_list without any workspace returns a config error", async () => {
    installFetch();
    const t = createAccountTools(new BitbucketClient({ ...baseConfig, workspace: undefined })).find(
      (x) => x.name === "projects_list"
    )!;
    const res = await t.handler({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/BITBUCKET_WORKSPACE/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/tools/account.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/tools/account.ts`**

```ts
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
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/tools/account.test.ts` — Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/account.ts tests/tools/account.test.ts
git commit -m "feat(account): user_me, workspaces_list, projects_list

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Repository tools (`repos_list`, `repos_get`, `branches_list`, `tags_list`)

**Files:**
- Create: `src/tools/repos.ts`, `tests/tools/repos.test.ts`

**Interfaces:**
- Consumes: Task 6 helpers (`defineTool`, `repoFields`, `workspaceField`, `fieldsField`, `filterFields`, `repoPath`), Task 4 pagination, Task 5 client.
- Produces: `createReposTools(client): ToolDefinition[]`.

- [ ] **Step 1: Write `tests/tools/repos.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { BitbucketClient } from "../../src/client.js";
import { createReposTools } from "../../src/tools/repos.js";
import { baseConfig, installFetch, mockResponse, lastCall } from "../helpers.js";

function tool(name: string) {
  const t = createReposTools(new BitbucketClient(baseConfig)).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

describe("repos tools", () => {
  it("exposes four read tools with repository scope", () => {
    const tools = createReposTools(new BitbucketClient(baseConfig));
    expect(tools.map((t) => t.name)).toEqual(["repos_list", "repos_get", "branches_list", "tags_list"]);
    expect(new Set(tools.map((t) => t.scopeHint))).toEqual(new Set(["repository"]));
  });

  it("repos_list hits /repositories/{ws} with role, q, sort", async () => {
    const fetchMock = installFetch(mockResponse({ body: { values: [] } }));
    await tool("repos_list").handler({ role: "member", q: 'name ~ "south"', sort: "-updated_on" });
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/2.0/repositories/southti");
    expect(url.searchParams.get("role")).toBe("member");
    expect(url.searchParams.get("q")).toBe('name ~ "south"');
    expect(url.searchParams.get("sort")).toBe("-updated_on");
    expect(url.searchParams.get("pagelen")).toBe("25");
  });

  it("repos_get hits /repositories/{ws}/{slug}", async () => {
    const fetchMock = installFetch(mockResponse({ body: { slug: "south-console" } }));
    const res = await tool("repos_get").handler({ repo_slug: "south-console", workspace: "acme" });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/acme/south-console");
    expect(JSON.parse(res.content[0].text).slug).toBe("south-console");
  });

  it("branches_list and tags_list hit refs endpoints with filters", async () => {
    const fetchMock = installFetch(mockResponse({ body: { values: [] } }), mockResponse({ body: { values: [] } }));
    await tool("branches_list").handler({ repo_slug: "r", q: 'name ~ "feature/"', sort: "-target.date" });
    let { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/2.0/repositories/southti/r/refs/branches");
    expect(url.searchParams.get("q")).toBe('name ~ "feature/"');
    await tool("tags_list").handler({ repo_slug: "r", pagelen: 5 });
    ({ url } = lastCall(fetchMock));
    expect(url.pathname).toBe("/2.0/repositories/southti/r/refs/tags");
    expect(url.searchParams.get("pagelen")).toBe("5");
  });

  it("propagates API errors as isError", async () => {
    installFetch(mockResponse({ status: 404, body: { error: { message: "Repository x/y not found" } } }));
    const res = await tool("repos_get").handler({ repo_slug: "y" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Not found \(404\)/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/tools/repos.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/tools/repos.ts`**

```ts
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
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/tools/repos.test.ts` — Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/repos.ts tests/tools/repos.test.ts
git commit -m "feat(repos): repos_list, repos_get, branches_list, tags_list

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Code tools (`commits_list`, `commits_get`, `diff_get`, `src_read`)

**Files:**
- Create: `src/tools/code.ts`, `tests/tools/code.test.ts`

**Interfaces:**
- Consumes: Task 6 helpers incl. `truncateBytes`, `encodePath`/`seg` (Task 5), `textResponse` (Task 3).
- Produces: `createCodeTools(client): ToolDefinition[]`.

- [ ] **Step 1: Write `tests/tools/code.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { BitbucketClient } from "../../src/client.js";
import { createCodeTools } from "../../src/tools/code.js";
import { baseConfig, installFetch, mockResponse, lastCall } from "../helpers.js";

function tool(name: string) {
  const t = createCodeTools(new BitbucketClient(baseConfig)).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

describe("code tools", () => {
  it("exposes four tools", () => {
    expect(createCodeTools(new BitbucketClient(baseConfig)).map((t) => t.name)).toEqual([
      "commits_list",
      "commits_get",
      "diff_get",
      "src_read"
    ]);
  });

  it("commits_list without revision hits /commits", async () => {
    const fetchMock = installFetch(mockResponse({ body: { values: [] } }));
    await tool("commits_list").handler({ repo_slug: "r" });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/commits");
  });

  it("commits_list with revision, path, include/exclude and cursor page", async () => {
    const fetchMock = installFetch(mockResponse({ body: { values: [] } }));
    await tool("commits_list").handler({
      repo_slug: "r",
      revision: "feature/x",
      path: "src/app.ts",
      include: ["feature/x"],
      exclude: ["master", "develop"],
      page: "abc123"
    });
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/2.0/repositories/southti/r/commits/feature%2Fx");
    expect(url.searchParams.get("path")).toBe("src/app.ts");
    expect(url.searchParams.getAll("include")).toEqual(["feature/x"]);
    expect(url.searchParams.getAll("exclude")).toEqual(["master", "develop"]);
    expect(url.searchParams.get("page")).toBe("abc123");
  });

  it("commits_get hits /commit/{hash}", async () => {
    const fetchMock = installFetch(mockResponse({ body: { hash: "abc" } }));
    await tool("commits_get").handler({ repo_slug: "r", hash: "abc" });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/commit/abc");
  });

  it("diff_get returns the raw patch by default", async () => {
    const fetchMock = installFetch(mockResponse({ text: "diff --git a/x b/x", headers: { "content-type": "text/plain" } }));
    const res = await tool("diff_get").handler({ repo_slug: "r", spec: "feature/x..master", context: 5, path: "x" });
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/2.0/repositories/southti/r/diff/feature%2Fx..master");
    expect(url.searchParams.get("context")).toBe("5");
    expect(url.searchParams.get("path")).toBe("x");
    expect(url.searchParams.has("fields")).toBe(false);
    expect(res.content[0].text).toBe("diff --git a/x b/x");
  });

  it("diff_get with diffstat=true returns JSON from /diffstat", async () => {
    const fetchMock = installFetch(mockResponse({ body: { values: [{ status: "modified" }] } }));
    const res = await tool("diff_get").handler({ repo_slug: "r", spec: "abc", diffstat: true, pagelen: 50 });
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/2.0/repositories/southti/r/diffstat/abc");
    expect(url.searchParams.get("pagelen")).toBe("50");
    expect(JSON.parse(res.content[0].text).values[0].status).toBe("modified");
  });

  it("src_read returns a directory listing as JSON", async () => {
    const fetchMock = installFetch(
      mockResponse({ body: { values: [{ path: "src", type: "commit_directory" }] } })
    );
    const res = await tool("src_read").handler({ repo_slug: "r", commit: "master", path: "" });
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/2.0/repositories/southti/r/src/master/");
    expect(url.searchParams.get("pagelen")).toBe("25");
    expect(JSON.parse(res.content[0].text).values[0].path).toBe("src");
  });

  it("src_read returns file content as text and encodes the path", async () => {
    const fetchMock = installFetch(
      mockResponse({ text: "export const a = 1;\n", headers: { "content-type": "text/plain; charset=utf-8" } })
    );
    const res = await tool("src_read").handler({ repo_slug: "r", commit: "feature/x", path: "src/my file.ts" });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/src/feature%2Fx/src/my%20file.ts");
    expect(res.content[0].text).toBe("export const a = 1;\n");
  });

  it("src_read truncates large files at max_bytes", async () => {
    installFetch(mockResponse({ text: "x".repeat(100), headers: { "content-type": "text/plain" } }));
    const res = await tool("src_read").handler({ repo_slug: "r", commit: "m", path: "big.txt", max_bytes: 10 });
    expect(res.content[0].text.startsWith("xxxxxxxxxx\n")).toBe(true);
    expect(res.content[0].text).toContain("[truncated: showing 10 of 100 bytes]");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/tools/code.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/tools/code.ts`**

```ts
import { z } from "zod";
import type { BitbucketClient } from "../client.js";
import { encodePath, seg } from "../client.js";
import { successResponse, textResponse } from "../errors.js";
import { paginationFields, paginationParams } from "../pagination.js";
import { defineTool, fieldsField, repoFields, repoPath, truncateBytes } from "./common.js";
import type { ToolDefinition } from "./types.js";

const DEFAULT_MAX_BYTES = 200_000;

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
        'Unified diff for a commit or between two refs. `spec` is a hash (diff against its parent) or "source..destination" (e.g. "feature/x..master" shows what feature/x adds to master). Set `diffstat` to true for a JSON per-file summary instead of the patch.',
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
        'Read a file or list a directory at a given commit/branch/tag. Empty `path` lists the repository root. Directories return a paginated JSON listing (type "commit_file" or "commit_directory"); files return their raw content, truncated at `max_bytes`.',
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
        const path = `${repoPath(client, input)}/src/${seg(input.commit)}/${encoded}`;
        const raw = await client.getRaw(path, { ...paginationParams(input) });
        if (raw.contentType.includes("json")) {
          return successResponse(JSON.parse(raw.text));
        }
        return textResponse(truncateBytes(raw.text, input.max_bytes ?? DEFAULT_MAX_BYTES));
      }
    })
  ];
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/tools/code.test.ts` — Expected: 10 pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/code.ts tests/tools/code.test.ts
git commit -m "feat(code): commits_list, commits_get, diff_get, src_read

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Pull request read tools (7)

**Files:**
- Create: `src/tools/pullrequests.ts` (read half), `tests/tools/pullrequests.read.test.ts`

**Interfaces:**
- Consumes: Task 6 helpers, Task 4 pagination, Task 5 client, Task 3 responses.
- Produces: `createPullRequestTools(client): ToolDefinition[]` — Task 11 appends the write tools to the same array. Internal helper `prPath(client, input, id): string` → `${repoPath}/pullrequests/${id}`.

- [ ] **Step 1: Write `tests/tools/pullrequests.read.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { BitbucketClient } from "../../src/client.js";
import { createPullRequestTools } from "../../src/tools/pullrequests.js";
import { baseConfig, installFetch, mockResponse, lastCall } from "../helpers.js";

function tool(name: string) {
  const t = createPullRequestTools(new BitbucketClient(baseConfig)).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

const READ = ["prs_list", "prs_get", "prs_diff", "prs_commits", "prs_comments_list", "prs_activity", "prs_statuses"];

describe("pull request read tools", () => {
  it("exposes the read tools with pullrequest scope", () => {
    const tools = createPullRequestTools(new BitbucketClient(baseConfig));
    for (const name of READ) {
      const t = tools.find((x) => x.name === name);
      expect(t, name).toBeDefined();
      expect(t!.scopeHint).toBe("pullrequest");
    }
  });

  it("prs_list repeats state, passes q/sort and pagination", async () => {
    const fetchMock = installFetch(mockResponse({ body: { values: [] } }));
    await tool("prs_list").handler({ repo_slug: "r", state: ["OPEN", "MERGED"], q: 'author.nickname = "t"', sort: "-updated_on", page: 2 });
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/2.0/repositories/southti/r/pullrequests");
    expect(url.searchParams.getAll("state")).toEqual(["OPEN", "MERGED"]);
    expect(url.searchParams.get("q")).toBe('author.nickname = "t"');
    expect(url.searchParams.get("sort")).toBe("-updated_on");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("prs_get hits /pullrequests/{id}", async () => {
    const fetchMock = installFetch(mockResponse({ body: { id: 7 } }));
    const res = await tool("prs_get").handler({ repo_slug: "r", id: 7 });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/7");
    expect(JSON.parse(res.content[0].text).id).toBe(7);
  });

  it("prs_diff returns raw patch, or diffstat JSON when asked", async () => {
    const fetchMock = installFetch(
      mockResponse({ text: "diff --git", headers: { "content-type": "text/plain" } }),
      mockResponse({ body: { values: [] } })
    );
    const patch = await tool("prs_diff").handler({ repo_slug: "r", id: 7 });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/7/diff");
    expect(lastCall(fetchMock).url.searchParams.has("fields")).toBe(false);
    expect(patch.content[0].text).toBe("diff --git");

    await tool("prs_diff").handler({ repo_slug: "r", id: 7, diffstat: true });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/7/diffstat");
  });

  it.each([
    ["prs_commits", "commits"],
    ["prs_comments_list", "comments"],
    ["prs_activity", "activity"],
    ["prs_statuses", "statuses"]
  ])("%s hits the %s sub-resource with pagination", async (name, sub) => {
    const fetchMock = installFetch(mockResponse({ body: { values: [] } }));
    await tool(name).handler({ repo_slug: "r", id: 3, pagelen: 10 });
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe(`/2.0/repositories/southti/r/pullrequests/3/${sub}`);
    expect(url.searchParams.get("pagelen")).toBe("10");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/tools/pullrequests.read.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/tools/pullrequests.ts` with the read tools**

```ts
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
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/tools/pullrequests.read.test.ts` — Expected: 8 pass (the `each` adds 4).

- [ ] **Step 5: Commit**

```bash
git add src/tools/pullrequests.ts tests/tools/pullrequests.read.test.ts
git commit -m "feat(prs): pull request read tools (list, get, diff, commits, comments, activity, statuses)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Pull request write tools (8)

**Files:**
- Modify: `src/tools/pullrequests.ts` (replace `createWriteTools` and remove the temporary trailing `export { compact, prPath, idField }`)
- Create: `tests/tools/pullrequests.write.test.ts`

**Interfaces:**
- Consumes: `prPath`, `idField`, `compact` from the same file.
- Produces: write tools appended to `createPullRequestTools(client)`.

- [ ] **Step 1: Write `tests/tools/pullrequests.write.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { BitbucketClient } from "../../src/client.js";
import { createPullRequestTools } from "../../src/tools/pullrequests.js";
import { baseConfig, installFetch, mockResponse, lastCall } from "../helpers.js";

function tool(name: string) {
  const t = createPullRequestTools(new BitbucketClient(baseConfig)).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

const body = (fetchMock: ReturnType<typeof installFetch>) => JSON.parse(String(lastCall(fetchMock).init.body));

describe("pull request write tools", () => {
  it("exposes 15 tools total with pullrequest:write on mutating ones", () => {
    const tools = createPullRequestTools(new BitbucketClient(baseConfig));
    expect(tools).toHaveLength(15);
    for (const name of ["prs_create", "prs_update", "prs_approve", "prs_unapprove", "prs_request_changes", "prs_merge", "prs_decline"]) {
      expect(tools.find((t) => t.name === name)!.scopeHint, name).toBe("pullrequest:write");
    }
    expect(tools.find((t) => t.name === "prs_comment_create")!.scopeHint).toBe("pullrequest");
  });

  it("prs_create builds the body with only given fields", async () => {
    const fetchMock = installFetch(mockResponse({ body: { id: 10 } }));
    await tool("prs_create").handler({ repo_slug: "r", title: "Feat", source_branch: "feature/x" });
    const { url, init } = lastCall(fetchMock);
    expect(init.method).toBe("POST");
    expect(url.pathname).toBe("/2.0/repositories/southti/r/pullrequests");
    expect(body(fetchMock)).toEqual({ title: "Feat", source: { branch: { name: "feature/x" } } });
  });

  it("prs_create with all fields", async () => {
    const fetchMock = installFetch(mockResponse({ body: { id: 10 } }));
    await tool("prs_create").handler({
      repo_slug: "r",
      title: "Feat",
      source_branch: "feature/x",
      destination_branch: "master",
      description: "desc",
      reviewers: ["{u1}", "{u2}"],
      close_source_branch: true,
      draft: false
    });
    expect(body(fetchMock)).toEqual({
      title: "Feat",
      description: "desc",
      source: { branch: { name: "feature/x" } },
      destination: { branch: { name: "master" } },
      reviewers: [{ uuid: "{u1}" }, { uuid: "{u2}" }],
      close_source_branch: true,
      draft: false
    });
  });

  it("prs_update sends PUT with partial body", async () => {
    const fetchMock = installFetch(mockResponse({ body: { id: 4 } }));
    await tool("prs_update").handler({ repo_slug: "r", id: 4, title: "New", destination_branch: "develop" });
    const { url, init } = lastCall(fetchMock);
    expect(init.method).toBe("PUT");
    expect(url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/4");
    expect(body(fetchMock)).toEqual({ title: "New", destination: { branch: { name: "develop" } } });
  });

  it("prs_comment_create supports plain, reply and inline comments", async () => {
    const fetchMock = installFetch(mockResponse({ body: { id: 1 } }), mockResponse({ body: { id: 2 } }));
    await tool("prs_comment_create").handler({ repo_slug: "r", id: 4, content: "LGTM" });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/4/comments");
    expect(body(fetchMock)).toEqual({ content: { raw: "LGTM" } });

    await tool("prs_comment_create").handler({
      repo_slug: "r",
      id: 4,
      content: "nit",
      parent_id: 99,
      inline: { path: "src/a.ts", to: 12 }
    });
    expect(body(fetchMock)).toEqual({ content: { raw: "nit" }, parent: { id: 99 }, inline: { path: "src/a.ts", to: 12 } });
  });

  it("prs_approve POSTs and prs_unapprove DELETEs /approve", async () => {
    const fetchMock = installFetch(mockResponse({ body: { approved: true } }), mockResponse({ status: 204 }));
    await tool("prs_approve").handler({ repo_slug: "r", id: 4 });
    expect(lastCall(fetchMock).init.method).toBe("POST");
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/4/approve");
    expect(lastCall(fetchMock).init.body).toBeUndefined();

    const res = await tool("prs_unapprove").handler({ repo_slug: "r", id: 4 });
    expect(lastCall(fetchMock).init.method).toBe("DELETE");
    expect(JSON.parse(res.content[0].text)).toEqual({ id: 4, approved: false });
  });

  it("prs_request_changes POSTs, or DELETEs when revoke=true", async () => {
    const fetchMock = installFetch(mockResponse({ body: {} }), mockResponse({ status: 204 }));
    await tool("prs_request_changes").handler({ repo_slug: "r", id: 4 });
    expect(lastCall(fetchMock).init.method).toBe("POST");
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/4/request-changes");
    const res = await tool("prs_request_changes").handler({ repo_slug: "r", id: 4, revoke: true });
    expect(lastCall(fetchMock).init.method).toBe("DELETE");
    expect(JSON.parse(res.content[0].text)).toEqual({ id: 4, changes_requested: false });
  });

  it("prs_merge sends strategy, message and close flag", async () => {
    const fetchMock = installFetch(mockResponse({ body: { state: "MERGED" } }));
    await tool("prs_merge").handler({ repo_slug: "r", id: 4, merge_strategy: "squash", message: "Release", close_source_branch: true });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/4/merge");
    expect(body(fetchMock)).toEqual({ type: "pullrequest", merge_strategy: "squash", message: "Release", close_source_branch: true });
  });

  it("prs_merge with no options sends only type", async () => {
    const fetchMock = installFetch(mockResponse({ body: { state: "MERGED" } }));
    await tool("prs_merge").handler({ repo_slug: "r", id: 4 });
    expect(body(fetchMock)).toEqual({ type: "pullrequest" });
  });

  it("prs_decline POSTs /decline", async () => {
    const fetchMock = installFetch(mockResponse({ body: { state: "DECLINED" } }));
    await tool("prs_decline").handler({ repo_slug: "r", id: 4 });
    expect(lastCall(fetchMock).init.method).toBe("POST");
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/4/decline");
  });

  it("403 on merge hints at pullrequest:write", async () => {
    installFetch(mockResponse({ status: 403, body: { error: { message: "forbidden" } } }));
    const res = await tool("prs_merge").handler({ repo_slug: "r", id: 4 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('"pullrequest:write"');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/tools/pullrequests.write.test.ts` — Expected: FAIL (`toHaveLength(15)` gets 7, tools not found).

- [ ] **Step 3: Replace `createWriteTools` in `src/tools/pullrequests.ts` and delete the trailing `export { compact, prPath, idField };` line**

```ts
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
      description: "Update title, description, destination branch, reviewers, close-source-branch flag or draft state of an open pull request. Only the given fields change.",
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
        const payload = compact({
          title: input.title,
          description: input.description,
          destination: input.destination_branch ? { branch: { name: input.destination_branch } } : undefined,
          reviewers: input.reviewers?.map((uuid) => ({ uuid })),
          close_source_branch: input.close_source_branch,
          draft: input.draft
        });
        return successResponse(await client.put(prPath(client, input, input.id), payload));
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
```

- [ ] **Step 4: Run all PR tests and typecheck** — `npx vitest run tests/tools/pullrequests.read.test.ts tests/tools/pullrequests.write.test.ts && npx tsc --noEmit` — Expected: 19 pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/tools/pullrequests.ts tests/tools/pullrequests.write.test.ts
git commit -m "feat(prs): pull request write tools (create, update, comment, approve, request changes, merge, decline)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Pipeline tools (4)

**Files:**
- Create: `src/tools/pipelines.ts`, `tests/tools/pipelines.test.ts`

**Interfaces:**
- Consumes: Task 6 helpers incl. `tailLines`; Task 5 client.
- Produces: `createPipelinesTools(client): ToolDefinition[]`.

- [ ] **Step 1: Write `tests/tools/pipelines.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { BitbucketClient } from "../../src/client.js";
import { createPipelinesTools } from "../../src/tools/pipelines.js";
import { baseConfig, installFetch, mockResponse, lastCall } from "../helpers.js";

function tool(name: string) {
  const t = createPipelinesTools(new BitbucketClient(baseConfig)).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

describe("pipeline tools", () => {
  it("exposes four tools with pipeline scope", () => {
    const tools = createPipelinesTools(new BitbucketClient(baseConfig));
    expect(tools.map((t) => t.name)).toEqual(["pipelines_list", "pipelines_get", "pipelines_steps_list", "pipelines_step_log"]);
    expect(new Set(tools.map((t) => t.scopeHint))).toEqual(new Set(["pipeline"]));
  });

  it("pipelines_list defaults sort to -created_on and builds q from target_branch", async () => {
    const fetchMock = installFetch(mockResponse({ body: { values: [] } }));
    await tool("pipelines_list").handler({ repo_slug: "r", target_branch: "master" });
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/2.0/repositories/southti/r/pipelines");
    expect(url.searchParams.get("sort")).toBe("-created_on");
    expect(url.searchParams.get("q")).toBe('target.ref_name="master"');
  });

  it("pipelines_list honours explicit sort and omits q without target_branch", async () => {
    const fetchMock = installFetch(mockResponse({ body: { values: [] } }));
    await tool("pipelines_list").handler({ repo_slug: "r", sort: "created_on", pagelen: 5 });
    const { url } = lastCall(fetchMock);
    expect(url.searchParams.get("sort")).toBe("created_on");
    expect(url.searchParams.has("q")).toBe(false);
    expect(url.searchParams.get("pagelen")).toBe("5");
  });

  it("pipelines_get and pipelines_steps_list encode the uuid", async () => {
    const fetchMock = installFetch(mockResponse({ body: {} }), mockResponse({ body: { values: [] } }));
    await tool("pipelines_get").handler({ repo_slug: "r", uuid: "{abc-123}" });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pipelines/%7Babc-123%7D");
    await tool("pipelines_steps_list").handler({ repo_slug: "r", uuid: "{abc-123}" });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pipelines/%7Babc-123%7D/steps");
  });

  it("pipelines_step_log returns the tail of the log", async () => {
    const log = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
    const fetchMock = installFetch(mockResponse({ text: log, headers: { "content-type": "application/octet-stream" } }));
    const res = await tool("pipelines_step_log").handler({ repo_slug: "r", uuid: "{p}", step_uuid: "{s}" });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pipelines/%7Bp%7D/steps/%7Bs%7D/log");
    expect(res.content[0].text.startsWith("[showing last 300 of 500 lines]\nline 201\n")).toBe(true);
    expect(res.content[0].text.endsWith("line 500")).toBe(true);
  });

  it("pipelines_step_log with tail_lines larger than the log returns it whole", async () => {
    installFetch(mockResponse({ text: "a\nb", headers: { "content-type": "text/plain" } }));
    const res = await tool("pipelines_step_log").handler({ repo_slug: "r", uuid: "{p}", step_uuid: "{s}", tail_lines: 10 });
    expect(res.content[0].text).toBe("a\nb");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/tools/pipelines.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/tools/pipelines.ts`**

```ts
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
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/tools/pipelines.test.ts` — Expected: 6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/pipelines.ts tests/tools/pipelines.test.ts
git commit -m "feat(pipelines): pipelines_list, pipelines_get, pipelines_steps_list, pipelines_step_log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Wire everything — `tools/index.ts`, `src/index.ts`, manual scripts

**Files:**
- Create: `src/tools/index.ts`, `scripts/list-tools.mjs`, `scripts/smoke.mjs`, `tests/tools/index.test.ts`
- Modify: `src/index.ts` (replace placeholder)

**Interfaces:**
- Consumes: all `create*Tools(client)` factories (Tasks 7–12), `registerTools` (Task 6), `loadConfig` (Task 2), `createLogger` (Task 1).
- Produces: `registerAllTools(server: McpServer, client: BitbucketClient): void`; `collectAllTools(client): ToolDefinition[]` (exported for tests and scripts).

- [ ] **Step 1: Write `tests/tools/index.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { BitbucketClient } from "../../src/client.js";
import { collectAllTools } from "../../src/tools/index.js";
import { baseConfig } from "../helpers.js";

describe("collectAllTools", () => {
  it("returns 30 uniquely named tools, each with a scope hint and description", () => {
    const tools = collectAllTools(new BitbucketClient(baseConfig));
    expect(tools).toHaveLength(30);
    expect(new Set(tools.map((t) => t.name)).size).toBe(30);
    for (const t of tools) {
      expect(t.scopeHint.length, t.name).toBeGreaterThan(0);
      expect(t.config.description.length, t.name).toBeGreaterThan(20);
      expect(t.name).toMatch(/^[a-z]+(_[a-z]+)+$/);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/tools/index.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/tools/index.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BitbucketClient } from "../client.js";
import { registerTools } from "./register.js";
import { createAccountTools } from "./account.js";
import { createReposTools } from "./repos.js";
import { createCodeTools } from "./code.js";
import { createPullRequestTools } from "./pullrequests.js";
import { createPipelinesTools } from "./pipelines.js";
import type { ToolDefinition } from "./types.js";

export function collectAllTools(client: BitbucketClient): ToolDefinition[] {
  return [
    ...createAccountTools(client),
    ...createReposTools(client),
    ...createCodeTools(client),
    ...createPullRequestTools(client),
    ...createPipelinesTools(client)
  ];
}

export function registerAllTools(server: McpServer, client: BitbucketClient): void {
  registerTools(server, collectAllTools(client));
}
```

- [ ] **Step 4: Replace `src/index.ts`**

```ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { BitbucketClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";

const SERVER_NAME = "bitbucket-cloud-mcp";
const SERVER_VERSION = "0.1.0";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    process.stderr.write(`${SERVER_NAME}: configuration error: ${(e as Error).message}\n`);
    process.exit(1);
  }

  const logger = createLogger(config.logLevel);
  for (const w of config.warnings) logger.warn(w);
  logger.info(
    `${SERVER_NAME} starting (auth=${config.auth.mode}, baseUrl=${config.baseUrl}, workspace=${config.workspace ?? "<none>"})`
  );

  const client = new BitbucketClient(config);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerAllTools(server, client);
  logger.info("Registered all tools");

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Connected to STDIO transport, ready");
}

main().catch((e) => {
  process.stderr.write(`${SERVER_NAME}: fatal error: ${(e as Error).message}\n`);
  process.exit(1);
});
```

- [ ] **Step 5: Create `scripts/list-tools.mjs`** (spawns the built server over STDIO and lists tools; no real credentials needed)

```js
// Usage: npm run build && npm run list-tools
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, BITBUCKET_ACCESS_TOKEN: process.env.BITBUCKET_ACCESS_TOKEN ?? "dummy-token" },
  stderr: "inherit"
});
const client = new Client({ name: "list-tools", version: "0.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`${tools.length} tools`);
for (const t of tools) console.log(`- ${t.name}: ${t.description.split(".")[0]}.`);
await client.close();
```

- [ ] **Step 6: Create `scripts/smoke.mjs`** (real API call; reads `.env` style vars from the environment)

```js
// Usage: npm run build && BITBUCKET_EMAIL=... BITBUCKET_API_TOKEN=... BITBUCKET_WORKSPACE=... npm run smoke
import { loadConfig } from "../dist/config.js";
import { BitbucketClient } from "../dist/client.js";

const config = loadConfig();
const client = new BitbucketClient(config);

if (config.auth.mode === "basic") {
  const me = await client.get("/user", { fields: "display_name,nickname,uuid" });
  console.log("user:", JSON.stringify(me));
} else {
  console.log("user: skipped (access tokens are not users)");
}

const ws = client.resolveWorkspace();
const repos = await client.get(`/repositories/${encodeURIComponent(ws)}`, {
  pagelen: 5,
  sort: "-updated_on",
  fields: "size,values.slug,values.full_name,values.updated_on"
});
console.log(`repos in ${ws} (${repos.size ?? "?"} total):`);
for (const r of repos.values ?? []) console.log(`- ${r.full_name} (${r.updated_on})`);
```

- [ ] **Step 7: Run the unit tests, build and list tools**

Run: `npm test && npm run build && npm run list-tools`
Expected: all tests pass (≈80), build ok, output starts with `30 tools` and lists `user_me` … `pipelines_step_log`. stderr shows the three startup log lines.

- [ ] **Step 8: Run the smoke script against the real API** (the executor asks the user for credentials if none are exported; skip and note it if unavailable)

Run: `set -a; source .env; set +a; npm run smoke`
Expected: user line (basic mode) and up to 5 repos from the workspace. A 401 here means the token or email is wrong; a 403 means missing `repository` scope.

- [ ] **Step 9: Commit**

```bash
git add src/index.ts src/tools/index.ts scripts tests/tools/index.test.ts
git commit -m "feat: wire all 30 tools into the STDIO server; add list-tools and smoke scripts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: README and release prep

**Files:**
- Create: `README.md`
- Modify: `.gitignore` (already has node_modules, dist, .env, .DS_Store — verify)

- [ ] **Step 1: Write `README.md`** with these sections and content (adapt the runrun-it-mcp README structure):

````markdown
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
claude mcp add --scope user bitbucket npx -- -y bitbucket-cloud-mcp \
  -e BITBUCKET_EMAIL=you@company.com \
  -e BITBUCKET_API_TOKEN=your-api-token \
  -e BITBUCKET_WORKSPACE=your-workspace
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

(one table per group: **Account**, **Repositories**, **Code**, **Pull requests — read**, **Pull requests — write**, **Pipelines**; columns Tool | Endpoint | Notes. Copy names and endpoints from the spec §7.)

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
````

- [ ] **Step 2: Fill the tools table** from spec §7 (30 rows; verify count with `grep -c '^| \`' README.md` ≥ 30).

- [ ] **Step 3: Verify the package contents**

Run: `npm run build && npm pack --dry-run`
Expected: tarball lists `dist/**`, `README.md`, `LICENSE`, `package.json` only.

- [ ] **Step 4: Full verification**

Run: `npm test && npx tsc --noEmit && npm run list-tools`
Expected: all green, `30 tools`.

- [ ] **Step 5: Commit**

```bash
git add README.md .gitignore
git commit -m "docs: README with installation, credentials, scopes and tool table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Publishing to npm (`npm publish --access public`) and creating the GitHub repo are **not** part of this plan; the maintainer triggers them manually after reviewing the package.

---

## Self-review

- **Spec coverage:** §2 decisions → Tasks 1, 2, 5; §3 config → Task 2; §4 client → Task 5 (adds `getRaw` so `src_read` can detect JSON directories; `getText` kept as in spec); §5 errors → Task 3; §6 pagination → Task 4; §7.1–7.6 all 30 tools → Tasks 7–12 (3+4+4+7+8+4 = 30); §8 layout → file map + Tasks 1, 13; §9 tests → each task; smoke script → Task 13; §10 README → Task 14; §11 out of scope → not implemented.
- **Type consistency:** `defineTool` signature identical in Tasks 6–12; `repoPath(client, input)` and `prPath(client, input, id)` used consistently; `paginationParams(input)` spreads `{ page?, pagelen }` everywhere; `installFetch`/`lastCall`/`mockResponse` helpers match across test files; `RepoInput` exported from common.ts and imported in pullrequests.ts.
- **Placeholders:** none. The README tools table is specified as "copy from spec §7" with a row-count check rather than literal duplication of 30 rows already in the spec.
