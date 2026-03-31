import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppBindings } from "./types.js";
import { auth } from "./lib/auth.js";
import { healthRoutes } from "./routes/health.js";
import { deviceRoutes } from "./routes/devices.js";
import { hitlistRoutes } from "./routes/hitlists.js";
import { ingestRoutes } from "./routes/ingest.js";
import { telemetryRoutes } from "./routes/telemetry.js";
import { syncRoutes } from "./routes/sync.js";
import { sessionContext, requireRole, requireUser } from "./middleware/session.js";
import { requireDevice } from "./middleware/device-auth.js";

export function createApp() {
  const app = new Hono<AppBindings>();

  app.use("*", cors({
    origin: ["http://localhost:3001", "http://localhost:3000"],
    credentials: true,
  }));
  app.use("*", sessionContext);

  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.route("/", healthRoutes);

  app.use("/api/devices", requireUser, requireRole("admin", "operator"));
  app.use("/api/devices/pairings", requireUser, requireRole("admin"));
  app.route("/", deviceRoutes);

  app.use("/api/hitlists", requireUser, requireRole("admin", "operator"));
  app.use("/api/hitlists/*", requireUser, requireRole("admin", "operator"));
  app.route("/", hitlistRoutes);

  app.use("/api/ingest/*", requireDevice);
  app.route("/", ingestRoutes);

  app.use("/api/telemetry/heartbeat", requireDevice);
  app.use("/api/telemetry/device/:deviceId", requireUser, requireRole("admin", "operator"));
  app.route("/", telemetryRoutes);

  app.use("/api/sync/hitlists/*", requireDevice);
  app.use("/api/sync/cursors", requireDevice);
  app.route("/", syncRoutes);

  app.get("/api/session", requireUser, (c) => {
    return c.json({
      success: true,
      data: {
        user: c.get("user"),
        session: c.get("session"),
      },
    });
  });

  return app;
}
