"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Bell, ShieldAlert, CheckCircle2, AlertTriangle, XCircle, Eye, Radio } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

type MatchStatus = "ALL" | "PENDING" | "ACKNOWLEDGED" | "ESCALATED" | "FALSE_POSITIVE" | "RESOLVED";

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

export default function AlertsPage() {
  const [activeTab, setActiveTab] = useState<MatchStatus>("ALL");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">Match events from workstation detections</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Radio className="h-3 w-3 animate-pulse text-primary" />
          Live monitoring
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as MatchStatus)}>
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
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="mt-6">
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
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
