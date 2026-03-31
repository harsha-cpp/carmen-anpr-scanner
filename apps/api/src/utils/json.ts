import type { Context } from "hono";

export function ok<T>(c: Context, data: T, status = 200) {
  return c.json({ success: true, data }, status as 200);
}

export function fail(c: Context, status: number, error: string, details?: unknown) {
  return c.json({ success: false, error, details }, status as 400);
}
