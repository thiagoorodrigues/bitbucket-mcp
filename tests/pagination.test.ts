import { describe, it, expect } from "vitest";
import { z } from "zod";
import { paginationFields, paginationParams, DEFAULT_PAGELEN } from "../src/pagination.js";

const schema = z.object(paginationFields);

describe("paginationFields", () => {
  it("accepts numeric and string page", () => {
    expect(schema.parse({ page: 3 }).page).toBe(3);
    expect(schema.parse({ page: "abc123" }).page).toBe("abc123");
  });

  it("rejects page 0 and empty string", () => {
    expect(schema.safeParse({ page: 0 }).success).toBe(false);
    expect(schema.safeParse({ page: "" }).success).toBe(false);
  });

  it("bounds pagelen to 1..100", () => {
    expect(schema.safeParse({ pagelen: 0 }).success).toBe(false);
    expect(schema.safeParse({ pagelen: 101 }).success).toBe(false);
    expect(schema.parse({ pagelen: 100 }).pagelen).toBe(100);
  });
});

describe("paginationParams", () => {
  it("applies default pagelen and leaves page undefined", () => {
    expect(paginationParams({})).toEqual({ page: undefined, pagelen: DEFAULT_PAGELEN });
  });

  it("passes through explicit values", () => {
    expect(paginationParams({ page: "cur", pagelen: 10 })).toEqual({ page: "cur", pagelen: 10 });
  });
});
