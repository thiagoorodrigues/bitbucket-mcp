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
