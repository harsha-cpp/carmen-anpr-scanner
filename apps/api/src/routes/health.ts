import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { ok } from "../utils/json.js";

export const healthRoutes = new Hono<AppBindings>();

healthRoutes.get("/health", (c) =>
  ok(c, {
    status: "ok",
    service: "apps/api",
    timestamp: new Date().toISOString(),
  }),
);
