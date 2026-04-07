"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, Globe, Lock, Radio, XCircle, Loader2, Radar } from "lucide-react";

import { auth } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3003";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3002";

type CheckStatus = "pending" | "pass" | "fail" | "checking";

type SystemCheck = {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  status: CheckStatus;
};

export default function StartupPage() {
  const router = useRouter();
  const { data: session } = auth.useSession();

  const [checks, setChecks] = useState<SystemCheck[]>([
    { id: "camera", label: "Camera", description: "Local video capture device", icon: Camera, status: "pending" },
    { id: "api", label: "Central API", description: API_BASE, icon: Globe, status: "pending" },
    { id: "ws", label: "WebSocket Server", description: WS_URL, icon: Radio, status: "pending" },
    { id: "auth", label: "Authentication", description: "Session validity", icon: Lock, status: "pending" },
  ]);

  const updateCheck = useCallback((id: string, status: CheckStatus) => {
    setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
  }, []);

  const runChecks = useCallback(async () => {
    setChecks((prev) => prev.map((c) => ({ ...c, status: "checking" as CheckStatus })));

    updateCheck("auth", session ? "pass" : "fail");

    try {
      const res = await fetch(`${API_BASE}/api/health`, { credentials: "include" });
      updateCheck("api", res.ok ? "pass" : "fail");
    } catch {
      updateCheck("api", "fail");
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("timeout"));
        }, 3000);
        ws.onopen = () => {
          clearTimeout(timeout);
          ws.close();
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("ws error"));
        };
      });
      updateCheck("ws", "pass");
    } catch {
      updateCheck("ws", "fail");
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => { t.stop(); });
      updateCheck("camera", "pass");
    } catch {
      updateCheck("camera", "fail");
    }
  }, [session, updateCheck]);

  useEffect(() => {
    runChecks();
    const id = setInterval(runChecks, 5000);
    return () => clearInterval(id);
  }, [runChecks]);

  const allPassed = checks.every((c) => c.status === "pass");

  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl glass glow-primary mb-2">
            <Radar className="w-7 h-7 text-primary" strokeWidth={1.5} />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">System Preflight</h1>
          <p className="text-sm text-muted-foreground">Verifying all subsystems before going live</p>
        </div>

        <div className="space-y-3">
          {checks.map((check) => {
            const Icon = check.icon;
            return (
              <div
                key={check.id}
                className={cn(
                  "glass rounded-xl px-4 py-3.5 flex items-center gap-4 transition-all",
                  check.status === "pass" && "border-success/25",
                  check.status === "fail" && "border-destructive/30 glow-destructive",
                )}
              >
                <div
                  className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                    check.status === "pass" && "bg-success/15 border border-success/25",
                    check.status === "fail" && "bg-destructive/15 border border-destructive/25",
                    check.status === "checking" && "bg-primary/10 border border-primary/20",
                    check.status === "pending" && "bg-muted/50 border border-border",
                  )}
                >
                  <Icon
                    className={cn(
                      "w-4 h-4",
                      check.status === "pass" && "text-success",
                      check.status === "fail" && "text-destructive",
                      check.status === "checking" && "text-primary",
                      check.status === "pending" && "text-muted-foreground",
                    )}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{check.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{check.description}</p>
                </div>

                <div className="shrink-0">
                  {check.status === "pass" && <CheckCircle2 className="w-5 h-5 text-success" />}
                  {check.status === "fail" && <XCircle className="w-5 h-5 text-destructive" />}
                  {check.status === "checking" && <Loader2 className="w-5 h-5 text-primary animate-spin" />}
                  {check.status === "pending" && <div className="w-5 h-5 rounded-full border border-border" />}
                </div>
              </div>
            );
          })}
        </div>

        <Button
          type="button"
          disabled={!allPassed}
          onClick={() => router.push("/workstation/scan")}
          className={cn(
            "w-full h-14 text-base font-semibold gap-2.5 rounded-xl",
            allPassed && "glow-primary",
          )}
        >
          <Radar className="w-5 h-5" />
          Go Live
        </Button>

        {!allPassed && (
          <p className="text-center text-xs text-muted-foreground/50">
            Auto-rechecking every 5 seconds&hellip;
          </p>
        )}
      </div>
    </div>
  );
}
