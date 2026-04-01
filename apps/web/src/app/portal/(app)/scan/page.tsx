"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Radar,
  AlertTriangle,
  CheckCircle2,
  Camera,
  ChevronDown,
  Activity,
  ShieldAlert,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3002";

const REGIONS = [
  { value: "SAS", label: "South Asia (SAS)" },
  { value: "EUR", label: "Europe (EUR)" },
  { value: "NAM", label: "North America (NAM)" },
  { value: "AFR", label: "Africa (AFR)" },
];

const INTERVALS = [
  { label: "0.5 fps (1 frame / 2s)", ms: 2000 },
  { label: "1 fps (1 frame / 1s)", ms: 1000 },
  { label: "2 fps (1 frame / 500ms)", ms: 500 },
  { label: "3 fps (fastest)", ms: 333 },
];

const MAX_FRAME_WIDTH = 720;
const JPEG_QUALITY = 0.88;
const CROP_WIDTH_RATIO = 0.84;
const CROP_HEIGHT_RATIO = 0.42;
const MAX_LOG_ENTRIES = 50;

type ScanStatus = "idle" | "connecting" | "scanning" | "error";

type WsDetection = {
  timestamp: string;
  plate: string;
  country: string;
  make: string;
  model: string;
  color: string;
  category: string;
  confidence: number;
  blacklist: boolean;
};

type ScanResult = {
  success: true;
  data: {
    detection: {
      id: string;
      plate: string;
      country: string | null;
      make: string | null;
      model: string | null;
      color: string | null;
      category: string | null;
      confidence: number | null;
      occurredAt: string;
    };
    matches: Array<{
      id: string;
      alertStatus: string;
      hitlistEntry: {
        id: string;
        plateOriginal: string;
        priority: string | null;
        reasonSummary: string | null;
        caseReference: string | null;
      };
    }>;
    isHit: boolean;
    matchCount: number;
  };
};

type ScanApiResponse =
  | ScanResult
  | { success: false; error: string };

type ScanLogEntry = {
  id: string;
  plate: string;
  timestamp: string;
  isHit: boolean;
  country: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  category: string | null;
  confidence: number | null;
  matches: Array<{
    id: string;
    alertStatus: string;
    hitlistEntry: {
      id: string;
      plateOriginal: string;
      priority: string | null;
      reasonSummary: string | null;
      caseReference: string | null;
    };
  }>;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function ScanPage() {
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [region, setRegion] = useState("SAS");
  const [intervalMs, setIntervalMs] = useState(1000);
  const [errorMsg, setErrorMsg] = useState("");
  const [scanLog, setScanLog] = useState<ScanLogEntry[]>([]);
  const [totalScans, setTotalScans] = useState(0);
  const [hitCount, setHitCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef = useRef<ScanStatus>("idle");

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

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

  useEffect(() => () => teardown(), [teardown]);

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
      ctx.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          if (!blob || ws.readyState !== WebSocket.OPEN) return;
          blob.arrayBuffer().then((buf) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(buf);
          });
        },
        "image/jpeg",
        JPEG_QUALITY,
      );
    }, frameIntervalMs);
  }

  async function handleDetection(detection: WsDetection) {
    try {
      const result = await api.post<ScanApiResponse>("/api/portal/scan", {
        plate: detection.plate,
        country: detection.country,
        make: detection.make,
        model: detection.model,
        color: detection.color,
        category: detection.category,
        confidence: detection.confidence,
        occurredAt: detection.timestamp,
      });

      if (!result.success) return;

      const entry: ScanLogEntry = {
        id: result.data.detection.id,
        plate: result.data.detection.plate,
        timestamp: result.data.detection.occurredAt,
        isHit: result.data.isHit,
        country: result.data.detection.country,
        make: result.data.detection.make,
        model: result.data.detection.model,
        color: result.data.detection.color,
        category: result.data.detection.category,
        confidence: result.data.detection.confidence,
        matches: result.data.matches,
      };

      setScanLog((prev) => [entry, ...prev].slice(0, MAX_LOG_ENTRIES));
      setTotalScans((n) => n + 1);
      if (result.data.isHit) setHitCount((n) => n + 1);
    } catch {}
  }

  async function startScanning() {
    setErrorMsg("");
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
      ws.send(JSON.stringify({ type: "start", region, continuous: true }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === "ready") {
          setStatus("scanning");
          startFrameCapture(ws, intervalMs);
        } else if (msg.type === "detection") {
          void handleDetection(msg.data as WsDetection);
        } else if (msg.type === "error") {
          setErrorMsg(msg.message || "Server error");
          setStatus("error");
          teardown();
        } else if (msg.type === "ended") {
          setStatus("idle");
          teardown();
        }
      } catch {}
    };

    ws.onerror = () => {
      setErrorMsg("WebSocket error — is the WS server running?");
      setStatus("error");
      teardown();
    };

    ws.onclose = () => {
      if (statusRef.current === "scanning") {
        setStatus("idle");
      }
    };
  }

  function stopScanning() {
    teardown();
    setStatus("idle");
  }

  const isActive = status === "scanning" || status === "connecting";

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Plate Scanner</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Continuous ANPR scanning with hitlist matching</p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="glass rounded-xl px-4 py-2.5 flex items-center gap-2.5">
            <Activity className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground leading-none">Total Scans</p>
              <p className="text-lg font-bold text-foreground tabular-nums leading-none mt-0.5">{totalScans}</p>
            </div>
          </div>
          <div
            className={cn(
              "glass rounded-xl px-4 py-2.5 flex items-center gap-2.5 transition-all",
              hitCount > 0 && "border-destructive/30 glow-destructive",
            )}
          >
            <ShieldAlert
              className={cn("w-4 h-4 shrink-0", hitCount > 0 ? "text-destructive" : "text-muted-foreground")}
            />
            <div>
              <p className="text-xs text-muted-foreground leading-none">Hits</p>
              <p
                className={cn(
                  "text-lg font-bold tabular-nums leading-none mt-0.5",
                  hitCount > 0 ? "text-destructive" : "text-foreground",
                )}
              >
                {hitCount}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
        <div className="lg:col-span-3 space-y-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="scan-region" className="text-xs text-muted-foreground block mb-1.5">Region</label>
                  <div className="relative">
                    <select
                      id="scan-region"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      disabled={isActive}
                      className="w-full appearance-none rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50 pr-8 cursor-pointer"
                    >
                      {REGIONS.map((r) => (
                        <option key={r.value} value={r.value} className="bg-background text-foreground">
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label htmlFor="scan-rate" className="text-xs text-muted-foreground block mb-1.5">Scan Rate</label>
                  <div className="relative">
                    <select
                      id="scan-rate"
                      value={intervalMs}
                      onChange={(e) => setIntervalMs(Number(e.target.value))}
                      disabled={isActive}
                      className="w-full appearance-none rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50 pr-8 cursor-pointer"
                    >
                      {INTERVALS.map((opt) => (
                        <option key={opt.ms} value={opt.ms} className="bg-background text-foreground">
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              </div>

              <div
                className={cn(
                  "relative overflow-hidden rounded-xl border aspect-video flex items-center justify-center",
                  status === "scanning" ? "border-primary/25" : "border-border",
                )}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={cn(
                    "w-full h-full object-cover rounded-xl",
                    (status === "idle" || status === "connecting" || status === "error") &&
                      "opacity-0 absolute inset-0",
                  )}
                />

                {(status === "idle" || status === "error") && (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground/30 select-none">
                    <Camera className="w-14 h-14" strokeWidth={1} />
                    <span className="text-sm">Camera preview</span>
                  </div>
                )}

                {status === "connecting" && (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <div className="h-9 w-9 rounded-full border-2 border-muted border-t-primary animate-spin" />
                    <span className="text-sm">Connecting…</span>
                  </div>
                )}

                {status === "scanning" && (
                  <>
                    <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-background/80 border border-primary/30 px-3 py-1.5 backdrop-blur-sm z-10">
                      <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                      <span className="text-xs font-semibold text-primary tracking-widest">SCANNING</span>
                    </div>
                    <div className="absolute inset-x-[8%] top-1/2 -translate-y-1/2 h-[42%] border border-dashed border-primary/20 rounded-lg pointer-events-none z-10" />
                  </>
                )}
              </div>

              {status === "error" && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {!isActive ? (
                <Button
                  type="button"
                  onClick={startScanning}
                  className="w-full h-12 text-sm font-semibold gap-2"
                >
                  <Radar className="w-4 h-4" />
                  Start Scanning
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={stopScanning}
                  className="w-full h-12 text-sm font-semibold"
                >
                  Stop Scanning
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="flex flex-col">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">Scan Log</span>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {scanLog.length}/{MAX_LOG_ENTRIES}
                </span>
              </div>

              <div className="overflow-y-auto space-y-2 max-h-[55vh] pr-0.5">
                {scanLog.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/30 select-none">
                    <Radar className="w-10 h-10 mb-2.5" strokeWidth={1} />
                    <span className="text-xs">No detections yet</span>
                    <span className="text-xs mt-0.5">Start scanning to see results</span>
                  </div>
                ) : (
                  scanLog.map((entry) => <ScanLogItem key={entry.id} entry={entry} />)
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

function ScanLogItem({ entry }: { entry: ScanLogEntry }) {
  const vehicleDetails = [entry.make, entry.model, entry.color, entry.country]
    .filter(Boolean)
    .join(" · ");

  const confidencePct =
    entry.confidence !== null
      ? entry.confidence <= 1
        ? Math.round(entry.confidence * 100)
        : Math.round(entry.confidence)
      : null;

  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition-all",
        entry.isHit
          ? "border-destructive/35 bg-destructive/5 glow-destructive"
          : "border-border bg-card/30",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {entry.isHit && (
            <span className="h-2 w-2 rounded-full bg-destructive animate-pulse shrink-0 mt-[3px]" />
          )}
          <span className="font-mono text-base font-bold tracking-widest text-foreground leading-none">
            {entry.plate}
          </span>
          <Badge variant={entry.isHit ? "destructive" : "success"}>
            {entry.isHit ? "HIT" : "CLEAR"}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0 mt-0.5">
          {formatTime(entry.timestamp)}
        </span>
      </div>

      {(vehicleDetails || confidencePct !== null) && (
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          {vehicleDetails && (
            <span className="text-xs text-muted-foreground">{vehicleDetails}</span>
          )}
          {confidencePct !== null && (
            <span className="text-xs text-muted-foreground/60 tabular-nums">{confidencePct}%</span>
          )}
        </div>
      )}

      {entry.isHit && entry.matches.length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          {entry.matches.map((m) => (
            <div
              key={m.id}
              className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2 space-y-0.5"
            >
              <div className="flex items-center gap-2 flex-wrap">
                {m.hitlistEntry.priority && (
                  <span className="text-xs font-semibold text-destructive uppercase tracking-wide">
                    {m.hitlistEntry.priority}
                  </span>
                )}
                {m.hitlistEntry.caseReference && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {m.hitlistEntry.caseReference}
                  </span>
                )}
                {!m.hitlistEntry.priority && !m.hitlistEntry.caseReference && (
                  <span className="text-xs font-semibold text-destructive">Match found</span>
                )}
              </div>
              {m.hitlistEntry.reasonSummary && (
                <p className="text-xs text-destructive/75 leading-snug">
                  {m.hitlistEntry.reasonSummary}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
