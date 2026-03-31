export interface SessionUser {
  id: string;
  email: string;
  name: string;
  username: string | null;
  role: string;
}

export interface SessionRecord {
  id: string;
  token: string;
  expiresAt: Date;
}

export interface DeviceContext {
  token: {
    id: string;
    label: string;
    deviceType: "WORKSTATION" | "TABLET";
    workstationId: string | null;
    tabletId: string | null;
  };
  workstation?: {
    id: string;
    deviceId: string;
    name: string;
    status: string;
  } | null;
  tablet?: {
    id: string;
    deviceId: string;
    name: string;
    status: string;
  } | null;
  deviceKey: string;
}

export interface AppBindings {
  Variables: {
    user: SessionUser | null;
    session: SessionRecord | null;
    device: DeviceContext | null;
  };
}
