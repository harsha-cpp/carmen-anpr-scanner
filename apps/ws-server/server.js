const { WebSocketServer } = require("ws");
const {
  connectDb,
  getBlacklistCollection,
  getDetectionsCollection,
  closeDb,
  DB_SCHEMA,
  BLACKLIST_COLLECTION,
  DETECTIONS_COLLECTION,
} = require("./lib/db");
const {
  seedDummyBlacklist,
  getBlacklistedPlates,
  isPlateBlacklisted,
} = require("./lib/blacklistService");
const {
  saveDetection,
  getRecentDetections,
} = require("./lib/detectionService");

// Support the newer realtime env name without breaking older deployments.
const VEHICLE_API_KEY =
  process.env.VEHICLE_API_KEY || process.env.CARMEN_API_KEY || "";
const VEHICLE_API_BASE =
  process.env.VEHICLE_API_BASE ||
  "https://ap-southeast-1.api.carmencloud.com/vehicle";
const WS_PORT = parseInt(process.env.WS_PORT || "3002");

const DEDUP_MS = 8000;

let blacklistCollection = null;
let detectionsCollection = null;
let db = null;

async function initDb() {
  db = await connectDb();
  blacklistCollection = await getBlacklistCollection();
  detectionsCollection = await getDetectionsCollection();
  const seedResult = await seedDummyBlacklist(db, blacklistCollection);
  console.log(
    `[db] connected ${DB_SCHEMA}.${BLACKLIST_COLLECTION} (seed inserted=${seedResult.inserted}, skipped=${seedResult.skipped})`,
  );
  console.log(`[db] connected ${DB_SCHEMA}.${DETECTIONS_COLLECTION}`);
}

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`Carmen ANPR WS server (Vehicle API) → ws://localhost:${WS_PORT}`);

initDb().catch((err) => {
  console.error(`[db] failed to initialize DB: ${err.message}`);
  db = null;
  blacklistCollection = null;
  detectionsCollection = null;
});

process.on("SIGINT", async () => {
  await closeDb().catch(() => {});
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeDb().catch(() => {});
  process.exit(0);
});

wss.on("connection", (ws) => {
  console.log("[+] client connected");

  let region = "sas";
  let started = false;
  let stopped = false;
  let continuous = false;
  let processing = false;
  let queuedFrame = null;
  const lastSeen = new Map();

  ws.on("message", async (data, isBinary) => {
    if (stopped) return;

    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "start" && !started) {
          if (!VEHICLE_API_KEY) {
            ws.send(
              JSON.stringify({
                type: "error",
                message:
                  "Realtime scanning is not configured: missing VEHICLE_API_KEY.",
              }),
            );
            stopped = true;
            return;
          }
          started = true;
          region = (msg.region || "sas").toLowerCase();
          continuous = Boolean(msg.continuous);
          console.log(`  session started, region=${region}, continuous=${continuous}`);
          ws.send(JSON.stringify({ type: "ready" }));
        } else if (msg.type === "getBlacklist") {
          if (!db || !blacklistCollection) {
            ws.send(
              JSON.stringify({
                type: "blacklist",
                success: false,
                message: "Blacklist DB unavailable",
                data: [],
              }),
            );
            return;
          }

          const data = await getBlacklistedPlates(db, blacklistCollection, 100);
          ws.send(
            JSON.stringify({
              type: "blacklist",
              success: true,
              count: data.length,
              data,
            }),
          );
        } else if (msg.type === "getRecentDetections") {
          if (!db || !detectionsCollection) {
            ws.send(
              JSON.stringify({
                type: "recentDetections",
                success: false,
                message: "Detections DB unavailable",
                data: [],
              }),
            );
            return;
          }

          const limit =
            Number(msg.limit) > 0 ? Math.min(Number(msg.limit), 500) : 100;
          const data = await getRecentDetections(
            db,
            detectionsCollection,
            limit,
          );
          ws.send(
            JSON.stringify({
              type: "recentDetections",
              success: true,
              count: data.length,
              data,
            }),
          );
        }
      } catch {}
      return;
    }

    if (!started) return;

    queuedFrame = Buffer.from(data);
    if (processing) return;
    void processLatestFrame();
  });

  async function processLatestFrame() {
    if (processing || stopped || !queuedFrame) return;
    processing = true;

    while (!stopped && queuedFrame) {
      const jpegBuffer = queuedFrame;
      queuedFrame = null;
      console.log(`  frame received (${jpegBuffer.length}b)`);

      const t0 = Date.now();
      try {
        const detections = await callVehicleAPI(jpegBuffer, region);
        const elapsed = Date.now() - t0;

        if (detections.length === 0) {
          console.log(
            `  frame: no plate (${elapsed}ms, ${jpegBuffer.length}b)`,
          );
        }

        const now = Date.now();
        for (const det of detections) {
          const last = lastSeen.get(det.plate) || 0;
          if (now - last < DEDUP_MS) continue;
          lastSeen.set(det.plate, now);

          console.log(
            `  detected: ${det.plate} (${det.country}) conf=${det.confidence} ${elapsed}ms`,
          );

          let blacklist = {
            isBlacklisted: false,
            normalizedPlate: "",
            record: null,
          };

          if (db && blacklistCollection) {
            try {
              blacklist = await isPlateBlacklisted(
                db,
                blacklistCollection,
                det.plate,
              );
            } catch (err) {
              console.error(`  blacklist check failed: ${err.message}`);
            }
          }

          if (db && detectionsCollection) {
            try {
              await saveDetection(db, detectionsCollection, det, {
                region,
                blacklist,
              });
            } catch (err) {
              console.error(`  detection save failed: ${err.message}`);
            }
          }

          if (ws.readyState === 1 && !stopped) {
            ws.send(
              JSON.stringify({
                type: "detection",
                data: {
                  ...det,
                  blacklist,
                },
              }),
            );
          }
          if (!continuous) {
            queuedFrame = null;
            stopped = true;
            break;
          }
        }
      } catch (err) {
        console.error(`  frame error: ${err.message}`);
      }
    }

    processing = false;
    if (!stopped && queuedFrame) {
      void processLatestFrame();
    }
  }

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    queuedFrame = null;
    console.log("[-] client disconnected");
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);
});

async function callVehicleAPI(jpegBuffer, region) {
  const form = new FormData();
  const blob = new Blob([jpegBuffer], { type: "image/jpeg" });
  form.append("image", blob, "frame.jpg");
  form.append("service", "anpr,mmr");

  const url = `${VEHICLE_API_BASE}/${region}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "X-Api-Key": VEHICLE_API_KEY },
    body: form,
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`API ${resp.status}: ${body.slice(0, 120)}`);
  }

  return parseVehicles(await resp.json());
}

function parseVehicles(json) {
  const results = [];
  for (const v of json?.data?.vehicles || []) {
    const plate = v.plate;
    if (!plate?.found || !plate?.unicodeText) continue;
    const mmr = v.mmr;
    results.push({
      timestamp: new Date().toISOString(),
      plate: plate.unicodeText,
      country: plate.country || "",
      category: mmr?.category || "",
      make: mmr?.make || "",
      model: mmr?.model || "",
      color: mmr?.colorName || "",
      confidence: plate.confidence ?? 0,
    });
  }
  return results;
}
