const { WebSocketServer } = require("ws");

// Support the newer realtime env name without breaking older deployments.
const VEHICLE_API_KEY =
  process.env.VEHICLE_API_KEY ||
  process.env.CARMEN_API_KEY ||
  "";
const VEHICLE_API_BASE = process.env.VEHICLE_API_BASE || "https://ap-southeast-1.api.carmencloud.com/vehicle";
const WS_PORT = parseInt(process.env.WS_PORT || "3002");

const DEDUP_MS = 8000;

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`Carmen ANPR WS server (Vehicle API) → ws://localhost:${WS_PORT}`);

wss.on("connection", (ws) => {
  console.log("[+] client connected");

  let region = "sas";
  let started = false;
  let stopped = false;
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
            ws.send(JSON.stringify({
              type: "error",
              message: "Realtime scanning is not configured: missing VEHICLE_API_KEY.",
            }));
            stopped = true;
            return;
          }
          started = true;
          region = (msg.region || "sas").toLowerCase();
          console.log(`  session started, region=${region}`);
          ws.send(JSON.stringify({ type: "ready" }));
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
          console.log(`  frame: no plate (${elapsed}ms, ${jpegBuffer.length}b)`);
        }

        const now = Date.now();
        for (const det of detections) {
          const last = lastSeen.get(det.plate) || 0;
          if (now - last < DEDUP_MS) continue;
          lastSeen.set(det.plate, now);

          console.log(`  detected: ${det.plate} (${det.country}) conf=${det.confidence} ${elapsed}ms`);
          if (ws.readyState === 1 && !stopped) {
            ws.send(JSON.stringify({ type: "detection", data: det }));
          }
          queuedFrame = null;
          stopped = true;
          break;
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
  for (const v of (json?.data?.vehicles || [])) {
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
