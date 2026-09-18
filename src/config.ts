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
