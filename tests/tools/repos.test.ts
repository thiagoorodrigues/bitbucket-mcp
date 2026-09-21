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
