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
