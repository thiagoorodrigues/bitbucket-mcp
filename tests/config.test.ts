import { describe, it, expect } from "vitest";
import { loadConfig, DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS } from "../src/config.js";

describe("loadConfig", () => {
  it("uses bearer mode with BITBUCKET_ACCESS_TOKEN", () => {
    const cfg = loadConfig({ BITBUCKET_ACCESS_TOKEN: "tok" });
    expect(cfg.auth).toEqual({ mode: "bearer", token: "tok" });
    expect(cfg.warnings).toEqual([]);
  });

  it("uses basic mode with email + api token", () => {
    const cfg = loadConfig({ BITBUCKET_EMAIL: "a@b.com", BITBUCKET_API_TOKEN: "t" });
    expect(cfg.auth).toEqual({ mode: "basic", email: "a@b.com", token: "t" });
  });

  it("prefers bearer when both are set and records a warning", () => {
    const cfg = loadConfig({
      BITBUCKET_ACCESS_TOKEN: "tok",
      BITBUCKET_EMAIL: "a@b.com",
      BITBUCKET_API_TOKEN: "t"
    });
    expect(cfg.auth.mode).toBe("bearer");
    expect(cfg.warnings[0]).toMatch(/using the access token/i);
  });

  it("fails when email is set without api token", () => {
    expect(() => loadConfig({ BITBUCKET_EMAIL: "a@b.com" })).toThrow(/BITBUCKET_API_TOKEN is missing/);
  });

  it("fails when api token is set without email", () => {
    expect(() => loadConfig({ BITBUCKET_API_TOKEN: "t" })).toThrow(/BITBUCKET_EMAIL is missing/);
  });

  it("fails with both options described when no credentials", () => {
    expect(() => loadConfig({})).toThrow(/BITBUCKET_ACCESS_TOKEN.*BITBUCKET_EMAIL \+ BITBUCKET_API_TOKEN/s);
  });

  it("treats blank values as unset", () => {
    expect(() => loadConfig({ BITBUCKET_ACCESS_TOKEN: "   " })).toThrow(/Missing credentials/);
  });

  it("applies defaults", () => {
    const cfg = loadConfig({ BITBUCKET_ACCESS_TOKEN: "tok" });
    expect(cfg.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(cfg.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(cfg.logLevel).toBe("info");
    expect(cfg.workspace).toBeUndefined();
  });

  it("reads optional overrides", () => {
    const cfg = loadConfig({
      BITBUCKET_ACCESS_TOKEN: "tok",
      BITBUCKET_WORKSPACE: "southti",
      BITBUCKET_BASE_URL: "https://proxy.local/2.0",
      BITBUCKET_TIMEOUT_MS: "5000",
      LOG_LEVEL: "debug"
    });
    expect(cfg.workspace).toBe("southti");
    expect(cfg.baseUrl).toBe("https://proxy.local/2.0");
    expect(cfg.timeoutMs).toBe(5000);
    expect(cfg.logLevel).toBe("debug");
  });

  it("rejects invalid LOG_LEVEL naming the env var", () => {
    expect(() => loadConfig({ BITBUCKET_ACCESS_TOKEN: "tok", LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });

  it("rejects non-numeric BITBUCKET_TIMEOUT_MS", () => {
    expect(() => loadConfig({ BITBUCKET_ACCESS_TOKEN: "tok", BITBUCKET_TIMEOUT_MS: "abc" })).toThrow(/BITBUCKET_TIMEOUT_MS/);
  });
});
