"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Search, SlidersHorizontal, Download, Calendar, Gauge, Globe, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

interface Filters {
  plate: string;
  dateFrom: string;
  dateTo: string;
  country: string;
  minConfidence: string;
}

export default function SearchPage() {
  const [filters, setFilters] = useState<Filters>({
    plate: "",
    dateFrom: "",
    dateTo: "",
    country: "",
    minConfidence: "",
  });
  const [showFilters, setShowFilters] = useState(false);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Detection Search</h1>
          <p className="text-sm text-muted-foreground mt-1">Search and filter plate detections</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled
          title="Available when detection query API is ready"
          className="cursor-not-allowed opacity-50"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <Card className="glass">
        <CardContent className="p-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by plate number..."
              value={filters.plate}
              onChange={(e) => updateFilter("plate", e.target.value)}
              className="pl-10"
            />
          </div>
          <Button
            type="button"
            variant={showFilters ? "default" : "outline"}
            onClick={() => setShowFilters(!showFilters)}
            className={cn(!showFilters && "glass glass-hover")}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
          </Button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4 pt-4 border-t border-border">
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Calendar className="h-3 w-3" /> From Date
              </Label>
              <Input type="date" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Calendar className="h-3 w-3" /> To Date
              </Label>
              <Input type="date" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Globe className="h-3 w-3" /> Country
              </Label>
              <Input type="text" placeholder="e.g. IN, US" value={filters.country} onChange={(e) => updateFilter("country", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Gauge className="h-3 w-3" /> Min Confidence
              </Label>
              <Input type="number" min="0" max="100" placeholder="0-100" value={filters.minConfidence}
                onChange={(e) => updateFilter("minConfidence", e.target.value)} />
            </div>
          </div>
        )}
        </CardContent>
      </Card>

      <Card className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plate</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Workstation</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Confidence</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Country</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Vehicle</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Snapshot</th>
              </tr>
            </thead>
            <tbody />
          </table>
        </div>

        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="glass rounded-full p-4 mb-4">
            <Car className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-foreground font-medium mb-1">No Detections Yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Detection search requires workstation data. Start ingesting from a configured workstation.
          </p>
        </div>
      </Card>
    </div>
  );
}
