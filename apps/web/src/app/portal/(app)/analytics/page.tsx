"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BarChart3, Cpu, Wifi, WifiOff, ListChecks, Loader2 } from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LineChart, Line,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";

interface Device { id: string; status: string }
interface Hitlist { id: string; name: string; status: string; versions: { entries: unknown[] }[] }
interface DevicesResponse { workstations: Device[]; tablets: Device[]; pairings: unknown[] }
type ApiResp<T> = { success: true; data: T } | { success: false; error: string };

const CHART_COLORS: Record<string, string> = {
  ACTIVE: "#4ade80",
  OFFLINE: "#f87171",
  PENDING: "#fbbf24",
  DISABLED: "#71717a",
};

function GlassTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-heavy rounded-lg px-3 py-2 text-xs">
      {label && <p className="text-muted-foreground mb-1">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }} className="font-medium">{p.name}: {p.value}</p>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [devices, setDevices] = useState<DevicesResponse | null>(null);
  const [hitlists, setHitlists] = useState<Hitlist[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<ApiResp<DevicesResponse>>("/api/devices"),
      api.get<ApiResp<Hitlist[]>>("/api/hitlists"),
    ])
      .then(([d, h]) => {
        if (d.success) setDevices(d.data);
        else setError(d.error);
        if (h.success) setHitlists(h.data);
        else if (!d.success) setError(h.error);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass rounded-xl p-6 border border-destructive/20 bg-destructive/5">
        <p className="text-destructive text-sm">{error}</p>
      </div>
    );
  }

  const allDevices = [...(devices?.workstations ?? []), ...(devices?.tablets ?? [])];
  const statusCounts = allDevices.reduce<Record<string, number>>((acc, d) => {
    acc[d.status] = (acc[d.status] ?? 0) + 1;
    return acc;
  }, {});

  const pieData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

  const barData = (hitlists ?? [])
    .filter((h) => h.status === "ACTIVE")
    .map((h) => ({
      name: h.name.length > 15 ? h.name.slice(0, 15) + "…" : h.name,
      entries: h.versions?.[0]?.entries?.length ?? 0,
    }));

  const totalEntries = barData.reduce((sum, b) => sum + b.entries, 0);
  const activeDevices = statusCounts["ACTIVE"] ?? 0;
  const offlineDevices = statusCounts["OFFLINE"] ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">System metrics and insights</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: "Total Devices", value: allDevices.length, icon: Cpu, color: "text-foreground" },
          { label: "Active", value: activeDevices, icon: Wifi, color: "text-success" },
          { label: "Offline", value: offlineDevices, icon: WifiOff, color: "text-destructive" },
          { label: "Hitlist Entries", value: totalEntries, icon: ListChecks, color: "text-info" },
        ].map((stat) => (
          <Card key={stat.label} className="glass">
            <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg bg-card", stat.color)}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className={cn("text-2xl font-semibold", stat.color)}>{stat.value}</p>
              </div>
            </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="glass">
          <CardContent className="p-6">
          <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            Device Status Distribution
          </h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value">
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={CHART_COLORS[entry.name] ?? "#71717a"} />
                  ))}
                </Pie>
                <Tooltip content={<GlassTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No devices registered</div>
          )}
          <div className="flex justify-center gap-4 mt-2">
            {pieData.map((d) => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs">
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[d.name] ?? "#71717a" }} />
                <span className="text-muted-foreground">{d.name} ({d.value})</span>
              </div>
            ))}
          </div>
          </CardContent>
        </Card>

        <Card className="glass">
          <CardContent className="p-6">
          <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            Hitlist Entries by Watchlist
          </h3>
          {barData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" tick={{ fill: "#71717a", fontSize: 11 }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} />
                <YAxis tick={{ fill: "#71717a", fontSize: 11 }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} />
                <Tooltip content={<GlassTooltip />} />
                <Bar dataKey="entries" fill="#60a5fa" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">No active hitlists</div>
          )}
          </CardContent>
        </Card>

        <Card className="glass lg:col-span-2">
          <CardContent className="p-6">
          <h3 className="text-sm font-medium text-foreground mb-4">System Health Timeline</h3>
          <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
            <div className="text-center">
              <LineChart className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>Telemetry timeline will populate when workstations report health metrics</p>
            </div>
          </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
