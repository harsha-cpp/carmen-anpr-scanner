"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Radar } from "lucide-react";

import { auth } from "@/lib/auth-client";

export default function WorkstationRoot() {
  const router = useRouter();
  const { data: session, isPending } = auth.useSession();

  useEffect(() => {
    if (isPending) return;
    if (session) {
      router.replace("/workstation/startup");
    } else {
      router.replace("/workstation/login");
    }
  }, [isPending, session, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-2xl glass glow-primary flex items-center justify-center">
          <Radar className="w-6 h-6 text-primary" strokeWidth={1.5} style={{ animation: "pulse 2s infinite" }} />
        </div>
        <p className="text-sm text-muted-foreground">Redirecting&hellip;</p>
      </div>
    </div>
  );
}
