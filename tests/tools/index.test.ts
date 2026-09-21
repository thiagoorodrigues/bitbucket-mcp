import { describe, it, expect } from "vitest";
import { BitbucketClient } from "../../src/client.js";
import { collectAllTools } from "../../src/tools/index.js";
import { baseConfig } from "../helpers.js";

describe("collectAllTools", () => {
  it("returns 30 uniquely named tools, each with a scope hint and description", () => {
    const tools = collectAllTools(new BitbucketClient(baseConfig));
    expect(tools).toHaveLength(30);
    expect(new Set(tools.map((t) => t.name)).size).toBe(30);
    for (const t of tools) {
      expect(t.scopeHint.length, t.name).toBeGreaterThan(0);
      expect(t.config.description.length, t.name).toBeGreaterThan(20);
      expect(t.name).toMatch(/^[a-z]+(_[a-z]+)+$/);
    }
  });
});
