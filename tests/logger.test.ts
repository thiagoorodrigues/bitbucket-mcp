import { describe, it, expect, vi, afterEach } from "vitest";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes messages at or above the threshold to stderr", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = createLogger("warn");
    logger.info("hidden");
    logger.warn("shown");
    logger.error("also shown");
    expect(write).toHaveBeenCalledTimes(2);
    expect(String(write.mock.calls[0][0])).toContain("[warn] shown");
    expect(String(write.mock.calls[1][0])).toContain("[error] also shown");
  });

  it("never writes to stdout", () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    createLogger("debug").debug("x");
    expect(out).not.toHaveBeenCalled();
  });
});
