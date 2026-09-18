import { describe, it, expect } from "vitest";
import { BitbucketClient } from "../../src/client.js";
import { createPullRequestTools } from "../../src/tools/pullrequests.js";
import { baseConfig, installFetch, mockResponse, lastCall } from "../helpers.js";

function tool(name: string) {
  const t = createPullRequestTools(new BitbucketClient(baseConfig)).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

const READ = ["prs_list", "prs_get", "prs_diff", "prs_commits", "prs_comments_list", "prs_activity", "prs_statuses"];

describe("pull request read tools", () => {
  it("exposes the read tools with pullrequest scope", () => {
    const tools = createPullRequestTools(new BitbucketClient(baseConfig));
    for (const name of READ) {
      const t = tools.find((x) => x.name === name);
      expect(t, name).toBeDefined();
      expect(t!.scopeHint).toBe("pullrequest");
    }
  });

  it("prs_list repeats state, passes q/sort and pagination", async () => {
    const fetchMock = installFetch(mockResponse({ body: { values: [] } }));
    await tool("prs_list").handler({ repo_slug: "r", state: ["OPEN", "MERGED"], q: 'author.nickname = "t"', sort: "-updated_on", page: 2 });
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/2.0/repositories/southti/r/pullrequests");
    expect(url.searchParams.getAll("state")).toEqual(["OPEN", "MERGED"]);
    expect(url.searchParams.get("q")).toBe('author.nickname = "t"');
    expect(url.searchParams.get("sort")).toBe("-updated_on");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("prs_get hits /pullrequests/{id}", async () => {
    const fetchMock = installFetch(mockResponse({ body: { id: 7 } }));
    const res = await tool("prs_get").handler({ repo_slug: "r", id: 7 });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/7");
    expect(JSON.parse(res.content[0].text).id).toBe(7);
  });

  it("prs_diff returns raw patch, or diffstat JSON when asked", async () => {
    const fetchMock = installFetch(
      mockResponse({ text: "diff --git", headers: { "content-type": "text/plain" } }),
      mockResponse({ body: { values: [] } })
    );
    const patch = await tool("prs_diff").handler({ repo_slug: "r", id: 7 });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/7/diff");
    expect(lastCall(fetchMock).url.searchParams.has("fields")).toBe(false);
    expect(patch.content[0].text).toBe("diff --git");

    await tool("prs_diff").handler({ repo_slug: "r", id: 7, diffstat: true });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/7/diffstat");
  });

  it.each([
    ["prs_commits", "commits"],
    ["prs_comments_list", "comments"],
    ["prs_activity", "activity"],
    ["prs_statuses", "statuses"]
  ])("%s hits the %s sub-resource with pagination", async (name, sub) => {
    const fetchMock = installFetch(mockResponse({ body: { values: [] } }));
    await tool(name).handler({ repo_slug: "r", id: 3, pagelen: 10 });
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe(`/2.0/repositories/southti/r/pullrequests/3/${sub}`);
    expect(url.searchParams.get("pagelen")).toBe("10");
  });
});
