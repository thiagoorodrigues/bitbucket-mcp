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
