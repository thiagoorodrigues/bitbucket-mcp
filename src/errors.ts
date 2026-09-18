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
