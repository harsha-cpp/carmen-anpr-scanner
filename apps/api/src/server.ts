import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { config } from "./lib/env.js";

const app = createApp();

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`apps/api listening on http://localhost:${info.port}`);
  },
);
