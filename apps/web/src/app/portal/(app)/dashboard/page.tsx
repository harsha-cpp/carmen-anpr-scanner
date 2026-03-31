"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Monitor, Tablet, Link2, FileText, AlertCircle, Activity, Clock, CheckCircle } from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

type DeviceStatus = "PENDING" | "ACTIVE" | "OFFLINE" | "DISABLED";
type HitlistStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

interface Workstation {
  id: string;
  name: string;
  status: DeviceStatus;
  lastSeenAt: string | null;
}

interface TabletDevice {
  id: string;
  name: string;
  status: DeviceStatus;
  lastSeenAt: string | null;
}

interface DevicePairing {
  id: string;
  workstationId: string;
  tabletId: string;
  createdAt: string;
  unpairedAt: string | null;
}

interface DevicesData {
  workstations: Workstation[];
  tablets: TabletDevice[];
  pairings: DevicePairing[];
}

interface HitlistVersion {
  versionNumber: number;
  entries: HitlistEntry[];
  createdAt?: string;
}

interface HitlistEntry {
  id: string;
  plateOriginal: string;
  plateNormalized: string;
}

interface HitlistItem {
  id: string;
  name: string;
  status: HitlistStatus;
  currentVersionNumber: number;
  versions: HitlistVersion[];
  createdAt: string;
}

type ApiResp<T> = { success: true; data: T } | { success: false; error: string };

function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: "oklch(0.72 0.19 145)",
    PENDING: "oklch(0.75 0.15 80)",
    OFFLINE: "oklch(0.60 0.20 25)",
    DISABLED: "oklch(0.40 0.005 260)",
  };
  return map[status] ?? "oklch(0.40 0.005 260)";
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SkeletonCard() {
  return (
    <Card className="glass animate-pulse">
      <CardContent className="p-6">
      <div className="h-5 w-5 rounded bg-muted" />
      <div className="mt-4 space-y-2">
        <div className="h-8 w-16 rounded bg-muted" />
        <div className="h-4 w-24 rounded bg-muted" />
      </div>
      </CardContent>
    </Card>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <Card className="glass glass-hover transition-all">
      <CardContent className="p-6">
      <div className="text-muted-foreground">{icon}</div>
      <div className="mt-4">
        <div className="text-3xl font-bold text-foreground tabular-nums">{value}</div>
        <div className="mt-1 text-sm text-muted-foreground">{label}</div>
        {sub && <div className="mt-2">{sub}</div>}
      </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [devices, setDevices] = useState<DevicesData | null>(null);
  const [hitlists, setHitlists] = useState<HitlistItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      setLoading(true);
      setError(null);
      try {
        const [devResp, hlResp] = await Promise.all([
          api.get<ApiResp<DevicesData>>("/api/devices"),
          api.get<ApiResp<HitlistItem[]>>("/api/hitlists"),
        ]);
        if (cancelled) return;
        if (devResp.success) setDevices(devResp.data);
        else setError(devResp.error);
        if (hlResp.success) setHitlists(hlResp.data);
        else if (!devResp.success) setError(hlResp.error);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchAll();
    return () => {
      cancelled = true;
    };
  }, []);

  const wsList = devices?.workstations ?? [];
  const activeWs = wsList.filter((w) => w.status === "ACTIVE").length;
  const offlineWs = wsList.filter((w) => w.status === "OFFLINE").length;
  const pendingWs = wsList.filter((w) => w.status === "PENDING").length;
  const activePairings = (devices?.pairings ?? []).filter((p) => !p.unpairedAt).length;
  const activeHitlists = (hitlists ?? []).filter((h) => h.status === "ACTIVE").length;

  const allDevices: Array<{ status: string }> = [
    ...(devices?.workstations ?? []),
    ...(devices?.tablets ?? []),
  ];

  const statusCounts = Object.entries(
    allDevices.reduce<Record<string, number>>((acc, d) => {
      acc[d.status] = (acc[d.status] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([name, value]) => ({ name, value, fill: getStatusColor(name) }));

  const recentActivity = [...(hitlists ?? [])]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">System overview and real-time device status</p>
      </div>

      {error && (
        <div className="glass rounded-xl p-4 border border-destructive/30 bg-destructive/5 flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {loading ? (
          ["ws", "tb", "pr", "hl"].map((k) => <SkeletonCard key={k} />)
        ) : (
          <>
            <StatCard
              icon={<Monitor className="h-5 w-5" />}
              label="Total Workstations"
              value={wsList.length}
              sub={
                <div className="flex gap-3 flex-wrap">
                  <Badge variant="success">{activeWs} active</Badge>
                  <Badge variant="secondary">{offlineWs} offline</Badge>
                  <Badge variant="warning">{pendingWs} pending</Badge>
                </div>
              }
            />
            <StatCard
              icon={<Tablet className="h-5 w-5" />}
              label="Total Tablets"
              value={devices?.tablets.length ?? 0}
            />
            <StatCard
              icon={<Link2 className="h-5 w-5" />}
              label="Active Pairings"
              value={activePairings}
              sub={
                <span className="text-xs text-muted-foreground">
                  {(devices?.pairings.length ?? 0) - activePairings} unpaired
                </span>
              }
            />
            <StatCard
              icon={<FileText className="h-5 w-5" />}
              label="Active Hitlists"
              value={activeHitlists}
              sub={
                <span className="text-xs text-muted-foreground">
                  {hitlists?.length ?? 0} total
                </span>
              }
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="glass xl:col-span-2">
          <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-5">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Device Status Distribution</h2>
          </div>
          {loading ? (
            <div className="h-48 animate-pulse rounded-lg bg-muted" />
          ) : statusCounts.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              No devices registered
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={statusCounts} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: "oklch(0.60 0.005 260)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "oklch(0.60 0.005 260)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "oklch(0.12 0.005 260 / 0.95)",
                    border: "1px solid oklch(1 0 0 / 0.1)",
                    borderRadius: "8px",
                    color: "oklch(0.96 0.005 80)",
                    fontSize: "12px",
                  }}
                  cursor={{ fill: "oklch(1 0 0 / 0.04)" }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {statusCounts.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          </CardContent>
        </Card>

        <Card className="glass">
          <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-5">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">System Status</h2>
          </div>
          {loading ? (
            <div className="space-y-3">
              {["s1", "s2", "s3", "s4"].map((k) => (
                <div key={k} className="flex items-center justify-between animate-pulse">
                  <div className="h-4 w-20 rounded bg-muted" />
                  <div className="h-4 w-6 rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {statusCounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No devices found</p>
              ) : (
                statusCounts.map(({ name, value, fill }) => (
                  <div key={name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full" style={{ background: fill }} />
                      <span className="text-sm text-muted-foreground">{name}</span>
                    </div>
                    <span className="text-sm font-semibold text-foreground tabular-nums">{value}</span>
                  </div>
                ))
              )}
            </div>
          )}
          </CardContent>
        </Card>
      </div>

      <Card className="glass">
        <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-5">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Recent Activity</h2>
        </div>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center justify-between animate-pulse py-2">
                <div className="h-4 w-48 rounded bg-muted" />
                <div className="h-4 w-24 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : recentActivity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hitlists found</p>
        ) : (
          <div className="divide-y divide-border">
            {recentActivity.map((h) => {
              const latestEntries = h.versions[0]?.entries.length ?? 0;
              return (
                <div key={h.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <CheckCircle
                      className={cn(
                        "h-4 w-4 shrink-0",
                        h.status === "ACTIVE" ? "text-success" : "text-muted-foreground",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{h.name}</p>
                      <p className="text-xs text-muted-foreground">
                        v{h.currentVersionNumber} · {latestEntries} entries ·{" "}
                        <Badge
                          variant={
                            h.status === "ACTIVE" ? "success" :
                            h.status === "DRAFT" ? "warning" :
                            "secondary"
                          }
                          className="capitalize"
                        >
                          {h.status.toLowerCase()}
                        </Badge>
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 ml-4">
                    {formatDate(h.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        </CardContent>
      </Card>
    </div>
  );
}
