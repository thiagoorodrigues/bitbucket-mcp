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
