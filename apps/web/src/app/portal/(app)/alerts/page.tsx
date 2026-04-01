"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Eye,
  Loader2,
  Radio,
  ShieldAlert,
  XCircle,
} from "lucide-react";

type MatchStatus = "ALL" | "PENDING" | "ACKNOWLEDGED" | "ESCALATED" | "FALSE_POSITIVE" | "RESOLVED";
type AlertStatus = Exclude<MatchStatus, "ALL">;
type ActionStatus = Exclude<AlertStatus, "PENDING">;

const STATUS_CONFIG: Record<Exclude<MatchStatus, "ALL">, { label: string; color: string; icon: typeof Bell }> = {
  PENDING: { label: "Pending", color: "bg-warning/10 text-warning border-warning/20", icon: AlertTriangle },
  ACKNOWLEDGED: { label: "Acknowledged", color: "bg-info/10 text-info border-info/20", icon: Eye },
  ESCALATED: { label: "Escalated", color: "bg-destructive/10 text-destructive border-destructive/20", icon: ShieldAlert },
  FALSE_POSITIVE: { label: "False Positive", color: "bg-muted text-muted-foreground border-border", icon: XCircle },
  RESOLVED: { label: "Resolved", color: "bg-success/10 text-success border-success/20", icon: CheckCircle2 },
};

const TABS: { value: MatchStatus; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "ACKNOWLEDGED", label: "Acknowledged" },
  { value: "ESCALATED", label: "Escalated" },
  { value: "FALSE_POSITIVE", label: "False Positive" },
  { value: "RESOLVED", label: "Resolved" },
];

const ACTION_STATUSES: ActionStatus[] = ["ACKNOWLEDGED", "ESCALATED", "FALSE_POSITIVE", "RESOLVED"];

const ACTION_LABELS: Record<ActionStatus, string> = {
  ACKNOWLEDGED: "Acknowledge",
  ESCALATED: "Escalate",
  FALSE_POSITIVE: "False Positive",
  RESOLVED: "Resolve",
};

interface MatchEventDetection {
  plate: string;
  country: string;
  make: string;
  model: string;
  color: string;
  category: string;
  confidence: number;
  occurredAt: string;
  snapshotUrl: string | null;
}

interface MatchEventWorkstation {
  name: string;
  deviceId: string;
}

interface MatchEventHitlistEntry {
  plateOriginal: string;
  reasonSummary: string | null;
  priority: string | null;
  caseReference: string | null;
}

interface MatchEvent {
  id: string;
  alertStatus: AlertStatus;
  note: string | null;
  createdAt: string;
  detection: MatchEventDetection | null;
  workstation: MatchEventWorkstation | null;
  hitlistEntry: MatchEventHitlistEntry | null;
}

interface MatchEventsPageData {
  items: MatchEvent[];
  total: number;
  page: number;
  limit: number;
}

interface MatchEventStats {
  PENDING: number;
  ACKNOWLEDGED: number;
  ESCALATED: number;
  FALSE_POSITIVE: number;
  RESOLVED: number;
  total: number;
}

type ApiResp<T> = { success: true; data: T } | { success: false; error: string };

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function priorityVariant(priority: string | null): "destructive" | "warning" | "secondary" | "outline" {
  if (priority === "HIGH") return "destructive";
  if (priority === "MEDIUM") return "warning";
  if (priority === "LOW") return "secondary";
  return "outline";
}

function getTabCount(tab: MatchStatus, stats: MatchEventStats | null): number | null {
  if (!stats) return null;
  if (tab === "ALL") return stats.total;
  return stats[tab];
}

function getVehicleSummary(detection: MatchEventDetection | null): string {
  if (!detection) return "Unknown vehicle";
  const parts = [detection.make, detection.model, detection.color, detection.category].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Unknown vehicle";
}

function EmptyState() {
  return (
    <div className="glass rounded-xl p-12 flex flex-col items-center justify-center text-center min-h-[400px]">
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
        <div className="relative glass rounded-full p-6">
          <Bell className="h-10 w-10 text-muted-foreground" />
        </div>
      </div>
      <h2 className="text-lg font-medium text-foreground mb-2">Awaiting Match Events</h2>
      <p className="text-sm text-muted-foreground max-w-md">
        Match events are ingested from workstations when detected plates match hitlist entries.
        Connect and configure a workstation to begin receiving real-time alerts.
      </p>

      <div className="mt-8 grid grid-cols-2 sm:grid-cols-5 gap-3 w-full max-w-2xl">
        {Object.entries(STATUS_CONFIG).map(([key, config]) => {
          const Icon = config.icon;
          return (
            <Badge
              key={key}
              variant="outline"
              className={cn("rounded-lg flex items-center gap-2 px-3 py-2 text-xs font-normal", config.color)}
            >
              <Icon className="h-3.5 w-3.5" />
              {config.label}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const [activeTab, setActiveTab] = useState<MatchStatus>("ALL");
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [stats, setStats] = useState<MatchEventStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionState, setActionState] = useState<{ eventId: string; nextStatus: ActionStatus; note: string } | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const hasMore = events.length < total;

  const fetchStats = useCallback(async () => {
    const resp = await api.get<ApiResp<MatchEventStats>>("/api/match-events/stats");
    if (!resp.success) throw new Error(resp.error);
    return resp.data;
  }, []);

  const fetchPage = useCallback(async (status: MatchStatus, pageToLoad: number) => {
    const params = new URLSearchParams({ page: String(pageToLoad), limit: "20" });
    if (status !== "ALL") params.set("status", status);

    const resp = await api.get<ApiResp<MatchEventsPageData>>(`/api/match-events?${params.toString()}`);
    if (!resp.success) throw new Error(resp.error);
    return resp.data;
  }, []);

  const loadInitial = useCallback(async (status: MatchStatus) => {
    setLoading(true);
    setError(null);
    try {
      const [pageData, statsData] = await Promise.all([fetchPage(status, 1), fetchStats()]);
      setEvents(pageData.items);
      setPage(pageData.page);
      setTotal(pageData.total);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
      setEvents([]);
      setTotal(0);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [fetchPage, fetchStats]);

  const refreshLoadedPages = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const pageCount = Math.max(page, 1);
      const pageResults = await Promise.all(
        Array.from({ length: pageCount }, (_, index) => fetchPage(activeTab, index + 1)),
      );
      const latest = pageResults[pageResults.length - 1];
      const statsData = await fetchStats();

      setEvents(pageResults.flatMap((result) => result.items));
      setPage(latest.page);
      setTotal(latest.total);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh alerts");
    } finally {
      setRefreshing(false);
    }
  }, [activeTab, fetchPage, fetchStats, page]);

  useEffect(() => {
    setActionState(null);
    void loadInitial(activeTab);
  }, [activeTab, loadInitial]);

  const tabCounts = useMemo(
    () => Object.fromEntries(TABS.map((tab) => [tab.value, getTabCount(tab.value, stats)])) as Record<MatchStatus, number | null>,
    [stats],
  );

  async function handleLoadMore() {
    if (loadingMore || !hasMore) return;

    setLoadingMore(true);
    setError(null);
    try {
      const nextPage = page + 1;
      const pageData = await fetchPage(activeTab, nextPage);
      setEvents((current) => [...current, ...pageData.items]);
      setPage(pageData.page);
      setTotal(pageData.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more alerts");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleConfirmAction() {
    if (!actionState) return;

    setSubmittingId(actionState.eventId);
    setError(null);

    try {
      const resp = await api.patch<ApiResp<MatchEvent>>(`/api/match-events/${actionState.eventId}`, {
        alertStatus: actionState.nextStatus,
        note: actionState.note.trim() || undefined,
      });

      if (!resp.success) {
        setError(resp.error);
        return;
      }

      setActionState(null);
      await refreshLoadedPages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update alert status");
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">Match events from workstation detections</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
          <Radio className="h-3 w-3 animate-pulse text-primary" />
          {refreshing ? "Refreshing" : "Live monitoring"}
        </div>
      </div>

      {error && (
        <div className="glass rounded-xl p-4 border border-destructive/30 bg-destructive/5 flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-destructive flex-1">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadInitial(activeTab)}
            className="glass glass-hover"
          >
            Retry
          </Button>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as MatchStatus)}>
        <TabsList className="flex gap-2 flex-wrap bg-transparent p-0 h-auto">
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                "glass glass-hover text-muted-foreground hover:text-foreground",
                "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none",
              )}
            >
              <span>{tab.label}</span>
              {tabCounts[tab.value] !== null && (
                <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[11px] leading-none data-[state=active]:bg-primary-foreground/20">
                  {tabCounts[tab.value]}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="mt-6">
            {loading ? (
              <div className="glass rounded-xl min-h-[400px] flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : events.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {events.map((event) => {
                    const detection = event.detection;
                    const status = STATUS_CONFIG[event.alertStatus];
                    const StatusIcon = status.icon;
                    const priority = event.hitlistEntry?.priority?.toUpperCase() ?? null;
                    const isActionOpen = actionState?.eventId === event.id;

                    return (
                      <Card key={event.id} className="glass glass-hover transition-all rounded-xl border-border/60">
                        <CardContent className="p-5 space-y-4">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-2xl font-bold font-mono tracking-wide text-foreground truncate">
                                  {detection?.plate ?? event.hitlistEntry?.plateOriginal ?? "Unknown plate"}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={cn("inline-flex items-center gap-1.5", status.color)}
                                >
                                  <StatusIcon className="h-3.5 w-3.5" />
                                  {status.label}
                                </Badge>
                                {priority && (
                                  <Badge variant={priorityVariant(priority)}>
                                    {priority} priority
                                  </Badge>
                                )}
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                <div>
                                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Vehicle</p>
                                  <p className="mt-1 text-foreground">{getVehicleSummary(detection)}</p>
                                </div>
                                <div>
                                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Workstation</p>
                                  <p className="mt-1 text-foreground">{event.workstation?.name ?? "Unknown workstation"}</p>
                                </div>
                              </div>

                              {event.hitlistEntry?.reasonSummary && (
                                <div className="rounded-lg border border-border bg-card/30 px-3 py-2">
                                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Reason summary</p>
                                  <p className="mt-1 text-sm text-foreground">{event.hitlistEntry.reasonSummary}</p>
                                </div>
                              )}

                              {event.note && (
                                <div className="rounded-lg border border-border/80 px-3 py-2">
                                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Latest note</p>
                                  <p className="mt-1 text-sm text-muted-foreground">{event.note}</p>
                                </div>
                              )}
                            </div>

                            <div className="text-xs text-muted-foreground shrink-0">
                              {timeAgo(event.createdAt)}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {ACTION_STATUSES.filter((nextStatus) => nextStatus !== event.alertStatus).map((nextStatus) => (
                              <Button
                                key={nextStatus}
                                type="button"
                                size="sm"
                                variant={isActionOpen && actionState?.nextStatus === nextStatus ? "default" : "outline"}
                                onClick={() => {
                                  setActionState((current) =>
                                    current?.eventId === event.id && current.nextStatus === nextStatus
                                      ? null
                                      : { eventId: event.id, nextStatus, note: "" },
                                  );
                                }}
                                className={cn(
                                  "text-xs",
                                  !(isActionOpen && actionState?.nextStatus === nextStatus) && "glass glass-hover",
                                )}
                                disabled={submittingId === event.id}
                              >
                                {ACTION_LABELS[nextStatus]}
                              </Button>
                            ))}
                          </div>

                          {isActionOpen && actionState && (
                            <div className="rounded-lg border border-border bg-card/30 p-3 space-y-3">
                              <div>
                                <Label
                                  htmlFor={`note-${event.id}`}
                                  className="text-xs font-medium text-muted-foreground mb-1.5 block"
                                >
                                  Optional note for {ACTION_LABELS[actionState.nextStatus].toLowerCase()}
                                </Label>
                                <Input
                                  id={`note-${event.id}`}
                                  type="text"
                                  value={actionState.note}
                                  onChange={(e) =>
                                    setActionState((current) =>
                                      current ? { ...current, note: e.target.value } : current,
                                    )
                                  }
                                  placeholder="Add operator note"
                                  className="w-full bg-input border border-border"
                                />
                              </div>
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setActionState(null)}
                                  className="glass glass-hover"
                                  disabled={submittingId === event.id}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => void handleConfirmAction()}
                                  disabled={submittingId === event.id}
                                >
                                  {submittingId === event.id && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                                  Confirm {ACTION_LABELS[actionState.nextStatus]}
                                </Button>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {hasMore && (
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleLoadMore()}
                      disabled={loadingMore}
                      className="glass glass-hover"
                    >
                      {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Load More
                    </Button>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
