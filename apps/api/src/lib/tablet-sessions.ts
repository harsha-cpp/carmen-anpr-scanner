import { createLogger } from "./logger.js";

const logger = createLogger("tablet-sessions");

export interface TabletConnection {
  deviceKey: string;
  deviceType: "WORKSTATION" | "TABLET";
  workstationId: string | null;
  tabletId: string | null;
  connectedAt: Date;
  lastCursor: string;
  send: (event: string, data: string) => void;
  close: () => void;
}

const connections = new Map<string, TabletConnection>();

export function registerTablet(conn: TabletConnection): void {
  const existing = connections.get(conn.deviceKey);
  if (existing) {
    existing.close();
  }
  connections.set(conn.deviceKey, conn);
  logger.info({ deviceKey: conn.deviceKey, total: connections.size }, "tablet connected");
}

export function unregisterTablet(deviceKey: string): void {
  connections.delete(deviceKey);
  logger.info({ deviceKey, total: connections.size }, "tablet disconnected");
}

function sendToConnections(
  event: string,
  data: string,
  predicate: (conn: TabletConnection) => boolean,
): number {
  let delivered = 0;
  for (const [deviceKey, conn] of connections) {
    if (!predicate(conn)) continue;

    try {
      conn.send(event, data);
      delivered++;
    } catch {
      logger.warn({ deviceKey }, "failed to deliver to tablet, removing");
      connections.delete(deviceKey);
    }
  }

  return delivered;
}

export function broadcastToTablets(event: string, data: string): number {
  return sendToConnections(event, data, () => true);
}

export function sendToWorkstationConnections(
  workstationId: string,
  event: string,
  data: string,
): number {
  return sendToConnections(
    event,
    data,
    (conn) => conn.workstationId === workstationId,
  );
}

export function sendToTabletIds(
  tabletIds: string[],
  event: string,
  data: string,
): number {
  if (tabletIds.length === 0) return 0;

  const targetIds = new Set(tabletIds);
  return sendToConnections(
    event,
    data,
    (conn) => conn.tabletId !== null && targetIds.has(conn.tabletId),
  );
}

export function getConnectedTabletCount(): number {
  let total = 0;
  for (const conn of connections.values()) {
    if (conn.deviceType === "TABLET") {
      total++;
    }
  }
  return total;
}

export function getConnectedDeviceKeys(): string[] {
  return Array.from(connections.keys());
}
