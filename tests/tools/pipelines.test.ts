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
