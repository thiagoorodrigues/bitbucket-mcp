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
