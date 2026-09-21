import { z } from "zod";

export const DEFAULT_PAGELEN = 25;
export const MAX_PAGELEN = 100;

export const paginationFields = {
  page: z
    .union([z.number().int().min(1), z.string().min(1)])
    .optional()
    .describe(
      "Page to fetch. A number for most endpoints. Commits use an opaque cursor: pass the `page` value from the previous response's `next` URL."
    ),
  pagelen: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGELEN)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PAGELEN}, max ${MAX_PAGELEN}).`)
};

export type PaginationInput = { page?: number | string; pagelen?: number };

export function paginationParams(input: PaginationInput): { page?: number | string; pagelen: number } {
  return { page: input.page, pagelen: input.pagelen ?? DEFAULT_PAGELEN };
}
