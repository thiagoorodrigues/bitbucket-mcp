import { describe, it, expect } from "vitest";
import { z } from "zod";
import { BitbucketClient } from "../../src/client.js";
import { BitbucketApiError, ConfigError } from "../../src/errors.js";
import { repoPath, compact, truncateBytes, tailLines, defineTool, repoFields } from "../../src/tools/common.js";
import { baseConfig } from "../helpers.js";

describe("repoPath", () => {
  it("encodes workspace and slug and uses the default workspace", () => {
    const client = new BitbucketClient(baseConfig);
    expect(repoPath(client, { repo_slug: "my repo" })).toBe("/repositories/southti/my%20repo");
    expect(repoPath(client, { workspace: "Other", repo_slug: "r" })).toBe("/repositories/Other/r");
  });
});

describe("compact", () => {
  it("drops undefined values only", () => {
    expect(compact({ a: 1, b: undefined, c: null, d: "" })).toEqual({ a: 1, c: null, d: "" });
  });
});

describe("truncateBytes", () => {
  it("returns text unchanged when within limit", () => {
    expect(truncateBytes("abc", 3)).toBe("abc");
  });

  it("truncates and appends a notice with sizes", () => {
    const out = truncateBytes("abcdefghij", 4);
    expect(out.startsWith("abcd")).toBe(true);
    expect(out).toContain("[truncated: showing 4 of 10 bytes]");
  });

  it("does not leave a broken multibyte char", () => {
    const out = truncateBytes("ééé", 3); // each é = 2 bytes
    expect(out.startsWith("é")).toBe(true);
    expect(out).not.toContain("�");
  });
});

describe("tailLines", () => {
  it("returns text unchanged when short enough", () => {
    expect(tailLines("a\nb", 5)).toBe("a\nb");
  });

  it("keeps the last n lines with a header", () => {
    expect(tailLines("1\n2\n3\n4", 2)).toBe("[showing last 2 of 4 lines]\n3\n4");
  });
});

describe("defineTool", () => {
  const schema = { ...repoFields, n: z.number() };

  it("builds a ToolDefinition and passes input through", async () => {
    const tool = defineTool({
      name: "demo_tool",
      title: "Demo",
      description: "d",
      scopeHint: "repository",
      inputSchema: schema,
      handler: async (input) => ({ content: [{ type: "text", text: `n=${input.n}` }] })
    });
    expect(tool.name).toBe("demo_tool");
    expect(tool.scopeHint).toBe("repository");
    expect(tool.config.inputSchema).toBe(schema);
    const res = await tool.handler({ repo_slug: "r", n: 2 });
    expect(res.content[0].text).toBe("n=2");
  });

  it("maps thrown API errors with the scope hint", async () => {
    const tool = defineTool({
      name: "x",
      title: "x",
      description: "x",
      scopeHint: "pullrequest:write",
      inputSchema: {},
      handler: async () => {
        throw new BitbucketApiError(403, "/p", "no", "{}");
      }
    });
    const res = await tool.handler({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('"pullrequest:write"');
  });

  it("maps ConfigError", async () => {
    const tool = defineTool({
      name: "x",
      title: "x",
      description: "x",
      scopeHint: "repository",
      inputSchema: {},
      handler: async () => {
        throw new ConfigError("No workspace given.");
      }
    });
    expect((await tool.handler({})).content[0].text).toMatch(/Configuration error/);
  });
});
