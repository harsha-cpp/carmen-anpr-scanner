import { createAuthClient } from "better-auth/react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3003";

export const auth = createAuthClient({
  baseURL: `${API_BASE}/api/auth`,
  fetchOptions: {
    credentials: "include",
  },
});
