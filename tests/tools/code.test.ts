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

  it("src_read encodes a slash-free path segment and hits the file directly", async () => {
    const fetchMock = installFetch(
      mockResponse({ text: "export const a = 1;\n", headers: { "content-type": "text/plain; charset=utf-8" } })
    );
    const res = await tool("src_read").handler({ repo_slug: "r", commit: "master", path: "src/my file.ts" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/src/master/src/my%20file.ts");
    expect(res.content[0].text).toBe("export const a = 1;\n");
  });

  it("src_read truncates large files at max_bytes", async () => {
    installFetch(mockResponse({ text: "x".repeat(100), headers: { "content-type": "text/plain" } }));
    const res = await tool("src_read").handler({ repo_slug: "r", commit: "m", path: "big.txt", max_bytes: 10 });
    expect(res.content[0].text.startsWith("xxxxxxxxxx\n")).toBe(true);
    expect(res.content[0].text).toContain("[truncated: showing 10 of 100 bytes]");
  });

  it("src_read resolves a slashed branch name to a commit hash before reading", async () => {
    const fetchMock = installFetch(
      mockResponse({ body: { target: { hash: "abc123" } } }),
      mockResponse({ text: "content", headers: { "content-type": "text/plain" } })
    );
    const res = await tool("src_read").handler({ repo_slug: "r", commit: "feature/x", path: "README.md" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = fetchMock.mock.calls[0];
    const firstUrl = new URL(first[0] as string);
    expect(firstUrl.pathname).toBe("/2.0/repositories/southti/r/refs/branches/feature%2Fx");
    expect(firstUrl.searchParams.get("fields")).toBe("target.hash");
    const { url: secondUrl } = lastCall(fetchMock);
    expect(secondUrl.pathname).toBe("/2.0/repositories/southti/r/src/abc123/README.md");
    expect(res.content[0].text).toBe("content");
  });

  it("src_read falls back to a tag when the slashed ref is not a branch", async () => {
    const fetchMock = installFetch(
      mockResponse({ status: 404, body: { error: { message: "Branch not found" } } }),
      mockResponse({ body: { target: { hash: "t1" } } }),
      mockResponse({ text: "tag content", headers: { "content-type": "text/plain" } })
    );
    const res = await tool("src_read").handler({ repo_slug: "r", commit: "release/1.0", path: "README.md" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const second = fetchMock.mock.calls[1];
    const secondUrl = new URL(second[0] as string);
    expect(secondUrl.pathname).toBe("/2.0/repositories/southti/r/refs/tags/release%2F1.0");
    const { url: thirdUrl } = lastCall(fetchMock);
    expect(thirdUrl.pathname).toBe("/2.0/repositories/southti/r/src/t1/README.md");
    expect(res.content[0].text).toBe("tag content");
  });
});
