const { createServer } = require("http");
const { WebSocketServer } = require("ws");
const { spawn } = require("child_process");

const BINARY_PATH =
  process.env.BINARY_PATH ||
  "/home/kaizen/sibi/adarecog/sdk_samples/samples/C++/build/05_cloud/cpp_sample_05_cloud";
const API_KEY = process.env.CARMEN_API_KEY || "";
const WS_PORT = parseInt(process.env.WS_PORT || "3002");
const BOUNDARY = "frame";

function createMjpegServer() {
  return new Promise((resolve) => {
    const clients = new Set();

    const server = createServer((req, res) => {
      res.setHeader(
        "Content-Type",
        `multipart/x-mixed-replace; boundary=${BOUNDARY}`
      );
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Pragma", "no-cache");
      res.writeHead(200);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      req.socket.on("error", () => clients.delete(res));
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      console.log(`  MJPEG stream on 127.0.0.1:${port}`);

      const pushFrame = (jpegBuffer) => {
        if (clients.size === 0) return;
        const header = `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpegBuffer.length}\r\n\r\n`;
        for (const res of clients) {
          try {
            res.write(header);
            res.write(jpegBuffer);
            res.write("\r\n");
          } catch {
            clients.delete(res);
          }
        }
      };

      resolve({ server, port, pushFrame });
    });
  });
}

function parseBuffer(buffer) {
  const detections = [];
  const parts = buffer.split(
    "------------------------------------------------------"
  );
  for (let i = 0; i < parts.length - 1; i++) {
    const block = parts[i].trim();
    if (!block) continue;
    const det = {};
    for (const line of block.split("\n").map((l) => l.trim()).filter(Boolean)) {
      if (line.startsWith("Unix timestamp:"))
        det.timestamp = line.replace("Unix timestamp:", "").trim();
      else if (line.startsWith("Plate text:"))
        det.plate = line.replace("Plate text:", "").trim();
      else if (line.startsWith("Country:"))
        det.country = line.replace("Country:", "").trim();
      else if (line.startsWith("Make:"))
        det.make = line.replace("Make:", "").trim();
      else if (line.startsWith("Model:"))
        det.model = line.replace("Model:", "").trim();
      else if (line.startsWith("Color:"))
        det.color = line.replace("Color:", "").trim();
      else if (line.startsWith("Category:"))
        det.category = line.replace("Category:", "").trim();
    }
    if (det.plate) detections.push(det);
  }
  const remaining = parts[parts.length - 1];
  return { detections, remaining };
}

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`Carmen ANPR WebSocket server → ws://localhost:${WS_PORT}`);

wss.on("connection", (ws) => {
  console.log("[+] client connected");

  let mjpeg = null;
  let proc = null;
  let stdoutBuf = "";
  let started = false;

  ws.on("message", async (data, isBinary) => {
    if (isBinary) {
      if (mjpeg) mjpeg.pushFrame(data);
      return;
    }

    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "start" && !started) {
        started = true;
        const region = msg.region || "EUR";
        console.log(`  region: ${region}`);

        mjpeg = await createMjpegServer();

        proc = spawn(BINARY_PATH, [
          region,
          `http://127.0.0.1:${mjpeg.port}/`,
          API_KEY,
        ]);

        proc.stdout.on("data", (chunk) => {
          stdoutBuf += chunk.toString();
          const { detections, remaining } = parseBuffer(stdoutBuf);
          stdoutBuf = remaining;
          for (const det of detections) {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: "detection", data: det }));
            }
          }
        });

        proc.stderr.on("data", () => {});

        proc.on("error", (err) => {
          console.error("binary error:", err.message);
          if (ws.readyState === 1)
            ws.send(JSON.stringify({ type: "error", message: err.message }));
        });

        proc.on("close", () => {
          if (ws.readyState === 1)
            ws.send(JSON.stringify({ type: "status", message: "stream ended" }));
        });

        ws.send(JSON.stringify({ type: "ready" }));
      }
    } catch {}
  });

  const cleanup = () => {
    console.log("[-] client disconnected");
    if (proc) {
      try { proc.kill("SIGKILL"); } catch {}
      proc = null;
    }
    if (mjpeg) {
      try { mjpeg.server.close(); } catch {}
      mjpeg = null;
    }
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);
});
