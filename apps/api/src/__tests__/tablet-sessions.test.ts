import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getConnectedTabletCount,
  registerTablet,
  sendToTabletIds,
  sendToWorkstationConnections,
  unregisterTablet,
} from "../lib/tablet-sessions.js";

const registeredKeys: string[] = [];

function registerConnection(options: {
  deviceKey: string;
  deviceType: "WORKSTATION" | "TABLET";
  workstationId?: string | null;
  tabletId?: string | null;
}) {
  const send = vi.fn();

  registerTablet({
    deviceKey: options.deviceKey,
    deviceType: options.deviceType,
    workstationId: options.workstationId ?? null,
    tabletId: options.tabletId ?? null,
    connectedAt: new Date(),
    lastCursor: "",
    send,
    close: vi.fn(),
  });

  registeredKeys.push(options.deviceKey);
  return send;
}

afterEach(() => {
  for (const key of registeredKeys.splice(0)) {
    unregisterTablet(key);
  }
});

describe("tablet sessions", () => {
  it("counts only tablet connections", () => {
    registerConnection({
      deviceKey: "workstation-1",
      deviceType: "WORKSTATION",
      workstationId: "ws-1",
    });
    registerConnection({
      deviceKey: "tablet-1",
      deviceType: "TABLET",
      tabletId: "tab-1",
    });

    expect(getConnectedTabletCount()).toBe(1);
  });

  it("routes workstation events only to matching workstation connections", () => {
    const workstationSend = registerConnection({
      deviceKey: "workstation-1",
      deviceType: "WORKSTATION",
      workstationId: "ws-1",
    });
    const tabletSend = registerConnection({
      deviceKey: "tablet-1",
      deviceType: "TABLET",
      tabletId: "tab-1",
    });

    const delivered = sendToWorkstationConnections("ws-1", "match-event", "{}");

    expect(delivered).toBe(1);
    expect(workstationSend).toHaveBeenCalledTimes(1);
    expect(tabletSend).not.toHaveBeenCalled();
  });

  it("routes tablet events only to the targeted tablet ids", () => {
    const firstTabletSend = registerConnection({
      deviceKey: "tablet-1",
      deviceType: "TABLET",
      tabletId: "tab-1",
    });
    const secondTabletSend = registerConnection({
      deviceKey: "tablet-2",
      deviceType: "TABLET",
      tabletId: "tab-2",
    });

    const delivered = sendToTabletIds(["tab-2"], "match-event", "{}");

    expect(delivered).toBe(1);
    expect(firstTabletSend).not.toHaveBeenCalled();
    expect(secondTabletSend).toHaveBeenCalledTimes(1);
  });
});
