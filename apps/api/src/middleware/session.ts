import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../types.js";
import { auth } from "../lib/auth.js";
import { fail } from "../utils/json.js";

export const sessionContext: MiddlewareHandler<AppBindings> = async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  c.set(
    "user",
    session?.user
      ? {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          username: session.user.username ?? null,
          role: session.user.role ?? "operator",
        }
      : null,
  );
  c.set("session", session?.session ?? null);
  c.set("device", null);

  await next();
};

export const requireUser: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!c.get("user")) {
    return fail(c, 401, "Authentication required.");
  }

  await next();
};

export function requireRole(...roles: string[]): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) {
      return fail(c, 401, "Authentication required.");
    }

    if (!roles.includes(user.role)) {
      return fail(c, 403, "Insufficient role for this action.");
    }

    await next();
  };
}
