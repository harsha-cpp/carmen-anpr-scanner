"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";

interface Detection {
  timestamp: string;
  plate: string;
  country: string;
  make: string;
  model: string;
  color: string;
  category: string;
}

type Status = "idle" | "connecting" | "scanning" | "detected" | "error";

const REGIONS = [
  { value: "SAS", label: "South Asia — India, Pakistan, Bangladesh (SAS)" },
  { value: "EUR", label: "Europe (EUR)" },
  { value: "NAM", label: "North America (NAM)" },
  { value: "AFR", label: "Africa (AFR)" },
];

const INTERVALS = [
  { label: "0.5 fps  (slowest — 1 frame / 2s)", ms: 2000 },
  { label: "1 fps  (1 frame / 1s)", ms: 1000 },
  { label: "2 fps  (1 frame / 500ms)", ms: 500 },
  { label: "3 fps  (fastest)", ms: 333 },
];

const MAX_FRAME_WIDTH = 720;
const JPEG_QUALITY = 0.88;
const CROP_WIDTH_RATIO = 0.84;
const CROP_HEIGHT_RATIO = 0.42;

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3002";

export default function RealtimePage() {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Detection | null>(null);
  const [region, setRegion] = useState("SAS");
  const [intervalMs, setIntervalMs] = useState(1000);
  const [errorMsg, setErrorMsg] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectedRef = useRef(false);

  const teardown = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => { t.stop(); });
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopAll = useCallback(() => {
    teardown();
    setStatus("idle");
  }, [teardown]);

  useEffect(() => () => teardown(), [teardown]);

  async function startScanning() {
    setResult(null);
    setErrorMsg("");
    detectedRef.current = false;
    setStatus("connecting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: "environment" } },
      });
    } catch {
      setErrorMsg("Camera access denied. Please allow camera permissions.");
      setStatus("error");
      return;
    }

    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start", region }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === "ready") {
          setStatus("scanning");
          startFrameCapture(ws, intervalMs);
        } else if (msg.type === "detection" && !detectedRef.current) {
          detectedRef.current = true;
          setResult(msg.data as Detection);
          setStatus("detected");
          teardown();
        } else if (msg.type === "error") {
          setErrorMsg(msg.message || "Server error");
          setStatus("error");
          teardown();
        } else if (msg.type === "ended") {
          teardown();
          setStatus("idle");
        }
      } catch {}
    };

    ws.onerror = () => {
      setErrorMsg("WebSocket error — is the WS server running?");
      setStatus("error");
      teardown();
    };

    ws.onclose = () => {
      if (status === "scanning") {
        teardown();
        setStatus("idle");
      }
    };
  }

  function startFrameCapture(ws: WebSocket, frameIntervalMs: number) {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    intervalRef.current = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (video.readyState < 2) return;

      const sourceWidth = video.videoWidth || 1280;
      const sourceHeight = video.videoHeight || 720;
      const cropWidth = Math.round(sourceWidth * CROP_WIDTH_RATIO);
      const cropHeight = Math.round(sourceHeight * CROP_HEIGHT_RATIO);
      const cropX = Math.round((sourceWidth - cropWidth) / 2);
      const cropY = Math.round((sourceHeight - cropHeight) / 2);
      const scale = Math.min(1, MAX_FRAME_WIDTH / cropWidth);

      canvas.width = Math.round(cropWidth * scale);
      canvas.height = Math.round(cropHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(
        video,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        canvas.width,
        canvas.height
      );

      canvas.toBlob(
        (blob) => {
          if (!blob || ws.readyState !== WebSocket.OPEN) return;
          blob.arrayBuffer().then((buf) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(buf);
          });
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    }, frameIntervalMs);
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <canvas ref={canvasRef} className="hidden" />
      <div className="mx-auto max-w-3xl px-4 py-12">
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-white">
            Carmen ANPR Scanner
          </h1>
        </header>

        <nav className="mb-8 flex justify-center gap-1 rounded-xl border border-gray-800 bg-gray-950 p-1">
          <Link
            href="/anpr"
            className="flex-1 rounded-lg px-4 py-2 text-center text-sm font-medium text-gray-400 hover:text-white transition-colors"
          >
            Upload Video
          </Link>
          <span className="flex-1 rounded-lg bg-white px-4 py-2 text-center text-sm font-medium text-black">
            Live Camera
          </span>
        </nav>

        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <label htmlFor="region-rt" className="text-sm text-gray-400 whitespace-nowrap">
              Region
            </label>
            <select
              id="region-rt"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              disabled={status === "scanning" || status === "connecting"}
              className="flex-1 rounded-lg border border-gray-700 bg-black px-3 py-2 text-sm text-white focus:border-white focus:outline-none disabled:opacity-50"
            >
              {REGIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="interval-rt" className="text-sm text-gray-400 whitespace-nowrap">
              Scan rate
            </label>
            <select
              id="interval-rt"
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              disabled={status === "scanning" || status === "connecting"}
              className="flex-1 rounded-lg border border-gray-700 bg-black px-3 py-2 text-sm text-white focus:border-white focus:outline-none disabled:opacity-50"
            >
              {INTERVALS.map((opt) => (
                <option key={opt.ms} value={opt.ms}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div
            className={[
              "relative overflow-hidden rounded-xl border bg-gray-950 aspect-video flex items-center justify-center",
              status === "scanning" ? "border-white/20" : "border-gray-800",
            ].join(" ")}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={[
                "w-full h-full object-cover rounded-xl",
                status === "idle" || status === "connecting" ? "opacity-0 absolute" : "",
              ].join(" ")}
            />

            {(status === "idle" || status === "error") && (
              <div className="flex flex-col items-center gap-3 text-gray-600">
                <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1} aria-label="camera">
                  <title>camera</title>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                </svg>
                <span className="text-sm">Camera preview</span>
              </div>
            )}

            {status === "connecting" && (
              <div className="flex flex-col items-center gap-3 text-gray-400">
                <div className="h-8 w-8 rounded-full border-2 border-gray-700 border-t-white animate-spin" />
                <span className="text-sm">Connecting…</span>
              </div>
            )}

            {status === "scanning" && (
              <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
                <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                Scanning
              </div>
            )}
          </div>

          {status === "error" && (
            <p className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
              {errorMsg}
            </p>
          )}

          {status === "idle" || status === "error" ? (
            <button
              type="button"
              onClick={startScanning}
              className="w-full rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-black hover:bg-gray-200 active:scale-[0.99] transition-all"
            >
              Start Camera
            </button>
          ) : status === "connecting" || status === "scanning" ? (
            <button
              type="button"
              onClick={stopAll}
              className="w-full rounded-xl border border-gray-700 px-6 py-3.5 text-sm font-semibold text-gray-300 hover:border-white hover:text-white transition-all"
            >
              Stop
            </button>
          ) : null}
        </div>

        {status === "detected" && result && (
          <div className="mt-6 space-y-4">
            <ResultCard detection={result} />
            <button
              type="button"
              onClick={startScanning}
              className="w-full rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-black hover:bg-gray-200 active:scale-[0.99] transition-all"
            >
              Next Scan
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({ detection: d }: { detection: Detection }) {
  const details = [
    ["Country", d.country],
    ["Make", d.make],
    ["Model", d.model],
    ["Color", d.color],
    ["Category", d.category],
    ["Detected At", d.timestamp],
  ].filter(([, value]) => Boolean(value));

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="relative space-y-5">
        <div className="flex items-center gap-2">
          <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-xs font-medium uppercase tracking-widest text-gray-400">Detected</span>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <span className="font-mono text-3xl font-bold tracking-[0.2em] text-white border border-gray-600 rounded-xl px-4 py-2 bg-black/40">
            {d.plate}
          </span>
          <span className="rounded-lg border border-gray-700 bg-black/40 px-3 py-1.5 text-sm text-gray-300">
            Scan stopped
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {details.map(([label, value]) => (
            <Field
              key={label}
              label={label}
              value={value}
              mono={label === "Detected At"}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">{label}</p>
      <p className={["text-sm text-white", mono ? "font-mono" : ""].join(" ")}>{value}</p>
    </div>
  );
}
