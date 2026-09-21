import { describe, it, expect } from "vitest";
import { BitbucketClient } from "../../src/client.js";
import { createPullRequestTools } from "../../src/tools/pullrequests.js";
import { baseConfig, installFetch, mockResponse, lastCall } from "../helpers.js";

function tool(name: string) {
  const t = createPullRequestTools(new BitbucketClient(baseConfig)).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

const body = (fetchMock: ReturnType<typeof installFetch>) => JSON.parse(String(lastCall(fetchMock).init.body));

describe("pull request write tools", () => {
  it("exposes 15 tools total with pullrequest:write on mutating ones", () => {
    const tools = createPullRequestTools(new BitbucketClient(baseConfig));
    expect(tools).toHaveLength(15);
    for (const name of ["prs_create", "prs_update", "prs_approve", "prs_unapprove", "prs_request_changes", "prs_merge", "prs_decline"]) {
      expect(tools.find((t) => t.name === name)!.scopeHint, name).toBe("pullrequest:write");
    }
    expect(tools.find((t) => t.name === "prs_comment_create")!.scopeHint).toBe("pullrequest");
  });

  it("prs_create builds the body with only given fields", async () => {
    const fetchMock = installFetch(mockResponse({ body: { id: 10 } }));
    await tool("prs_create").handler({ repo_slug: "r", title: "Feat", source_branch: "feature/x" });
    const { url, init } = lastCall(fetchMock);
    expect(init.method).toBe("POST");
    expect(url.pathname).toBe("/2.0/repositories/southti/r/pullrequests");
    expect(body(fetchMock)).toEqual({ title: "Feat", source: { branch: { name: "feature/x" } } });
  });

  it("prs_create with all fields", async () => {
    const fetchMock = installFetch(mockResponse({ body: { id: 10 } }));
    await tool("prs_create").handler({
      repo_slug: "r",
      title: "Feat",
      source_branch: "feature/x",
      destination_branch: "master",
      description: "desc",
      reviewers: ["{u1}", "{u2}"],
      close_source_branch: true,
      draft: false
    });
    expect(body(fetchMock)).toEqual({
      title: "Feat",
      description: "desc",
      source: { branch: { name: "feature/x" } },
      destination: { branch: { name: "master" } },
      reviewers: [{ uuid: "{u1}" }, { uuid: "{u2}" }],
      close_source_branch: true,
      draft: false
    });
  });

  it("prs_update fetches current values first and merges supplied fields into the PUT body", async () => {
    const fetchMock = installFetch(
      mockResponse({
        body: {
          title: "Old",
          description: "d",
          destination: { branch: { name: "master" } },
          reviewers: [{ uuid: "{u1}" }],
          close_source_branch: false,
          draft: false
        }
      }),
      mockResponse({ body: { id: 4 } })
    );
    await tool("prs_update").handler({ repo_slug: "r", id: 4, title: "New", destination_branch: "develop" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const first = fetchMock.mock.calls[0];
    const firstUrl = new URL(first[0] as string);
    const firstInit = first[1] as RequestInit;
    expect(firstInit.method).toBe("GET");
    expect(firstUrl.pathname).toBe("/2.0/repositories/southti/r/pullrequests/4");
    expect(firstUrl.searchParams.get("fields")).toBe(
      "title,description,destination.branch.name,reviewers.uuid,close_source_branch,draft"
    );

    const { url, init } = lastCall(fetchMock);
    expect(init.method).toBe("PUT");
    expect(url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/4");
    expect(body(fetchMock)).toEqual({
      title: "New",
      description: "d",
      destination: { branch: { name: "develop" } },
      reviewers: [{ uuid: "{u1}" }],
      close_source_branch: false,
      draft: false
    });
  });

  it("prs_update with reviewers: [] sends an explicit empty reviewer list", async () => {
    const fetchMock = installFetch(
      mockResponse({
        body: {
          title: "Old",
          description: "d",
          destination: { branch: { name: "master" } },
          reviewers: [{ uuid: "{u1}" }],
          close_source_branch: false,
          draft: false
        }
      }),
      mockResponse({ body: { id: 4 } })
    );
    await tool("prs_update").handler({ repo_slug: "r", id: 4, reviewers: [] });
    expect(body(fetchMock)).toEqual({
      title: "Old",
      description: "d",
      destination: { branch: { name: "master" } },
      reviewers: [],
      close_source_branch: false,
      draft: false
    });
  });

  it("prs_comment_create supports plain, reply and inline comments", async () => {
    const fetchMock = installFetch(mockResponse({ body: { id: 1 } }), mockResponse({ body: { id: 2 } }));
    await tool("prs_comment_create").handler({ repo_slug: "r", id: 4, content: "LGTM" });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/4/comments");
    expect(body(fetchMock)).toEqual({ content: { raw: "LGTM" } });

    await tool("prs_comment_create").handler({
      repo_slug: "r",
      id: 4,
      content: "nit",
      parent_id: 99,
      inline: { path: "src/a.ts", to: 12 }
    });
    expect(body(fetchMock)).toEqual({ content: { raw: "nit" }, parent: { id: 99 }, inline: { path: "src/a.ts", to: 12 } });
  });

  it("prs_approve POSTs and prs_unapprove DELETEs /approve", async () => {
    const fetchMock = installFetch(mockResponse({ body: { approved: true } }), mockResponse({ status: 204 }));
    await tool("prs_approve").handler({ repo_slug: "r", id: 4 });
    expect(lastCall(fetchMock).init.method).toBe("POST");
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/4/approve");
    expect(lastCall(fetchMock).init.body).toBeUndefined();

    const res = await tool("prs_unapprove").handler({ repo_slug: "r", id: 4 });
    expect(lastCall(fetchMock).init.method).toBe("DELETE");
    expect(JSON.parse(res.content[0].text)).toEqual({ id: 4, approved: false });
  });

  it("prs_request_changes POSTs, or DELETEs when revoke=true", async () => {
    const fetchMock = installFetch(mockResponse({ body: {} }), mockResponse({ status: 204 }));
    await tool("prs_request_changes").handler({ repo_slug: "r", id: 4 });
    expect(lastCall(fetchMock).init.method).toBe("POST");
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/4/request-changes");
    const res = await tool("prs_request_changes").handler({ repo_slug: "r", id: 4, revoke: true });
    expect(lastCall(fetchMock).init.method).toBe("DELETE");
    expect(JSON.parse(res.content[0].text)).toEqual({ id: 4, changes_requested: false });
  });

  it("prs_merge sends strategy, message and close flag", async () => {
    const fetchMock = installFetch(mockResponse({ body: { state: "MERGED" } }));
    await tool("prs_merge").handler({ repo_slug: "r", id: 4, merge_strategy: "squash", message: "Release", close_source_branch: true });
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/4/merge");
    expect(body(fetchMock)).toEqual({ type: "pullrequest", merge_strategy: "squash", message: "Release", close_source_branch: true });
  });

  it("prs_merge with no options sends only type", async () => {
    const fetchMock = installFetch(mockResponse({ body: { state: "MERGED" } }));
    await tool("prs_merge").handler({ repo_slug: "r", id: 4 });
    expect(body(fetchMock)).toEqual({ type: "pullrequest" });
  });

  it("prs_decline POSTs /decline", async () => {
    const fetchMock = installFetch(mockResponse({ body: { state: "DECLINED" } }));
    await tool("prs_decline").handler({ repo_slug: "r", id: 4 });
    expect(lastCall(fetchMock).init.method).toBe("POST");
    expect(lastCall(fetchMock).url.pathname).toBe("/2.0/repositories/southti/r/pullrequests/4/decline");
  });

  it("403 on merge hints at pullrequest:write", async () => {
    installFetch(mockResponse({ status: 403, body: { error: { message: "forbidden" } } }));
    const res = await tool("prs_merge").handler({ repo_slug: "r", id: 4 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('"pullrequest:write"');
  });
});
