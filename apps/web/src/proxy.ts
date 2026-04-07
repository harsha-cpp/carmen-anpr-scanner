import { NextRequest, NextResponse } from "next/server";

const API_BASE =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3003";

const PUBLIC_PATHS = [
  "/_next",
  "/api",
  "/fonts",
  "/favicon.ico",
];

const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
];

function getSessionCookie(req: NextRequest): string | undefined {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = req.cookies.get(name)?.value;
    if (value) return value;
  }
  return undefined;
}

const roleCache = new Map<string, { role: string | null; expiresAt: number }>();
const ROLE_CACHE_TTL_MS = 30_000;

async function fetchRole(cookie: string): Promise<string | null> {
  const cached = roleCache.get(cookie);
  if (cached && cached.expiresAt > Date.now()) return cached.role;

  let role: string | null;
  try {
    const res = await fetch(`${API_BASE}/api/session`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      role = null;
    } else {
      const json = await res.json();
      role = json?.data?.user?.role ?? null;
    }
  } catch {
    role = null;
  }

  roleCache.set(cookie, { role, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });

  // Evict expired entries when cache is too large
  if (roleCache.size > 500) {
    const now = Date.now();
    for (const [key, value] of roleCache) {
      if (value.expiresAt <= now) {
        roleCache.delete(key);
      }
    }
  }

  return role;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = getSessionCookie(req);

  if (pathname.startsWith("/workstation/login")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/portal/login")) {
    if (!token) return NextResponse.next();
    const cookieHeader = req.headers.get("cookie") ?? "";
    const role = await fetchRole(cookieHeader);
    if (role === "scanner") {
      return NextResponse.redirect(new URL("/workstation/scan", req.url));
    }
    if (role) {
      return NextResponse.redirect(new URL("/portal/dashboard", req.url));
    }
    return NextResponse.next();
  }

  if (!token) {
    if (pathname.startsWith("/workstation")) {
      return NextResponse.redirect(new URL("/workstation/login", req.url));
    }
    const loginUrl = new URL("/portal/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const cookieHeader = req.headers.get("cookie") ?? "";
  const role = await fetchRole(cookieHeader);

  if (!role) {
    if (pathname.startsWith("/workstation")) {
      return NextResponse.redirect(new URL("/workstation/login", req.url));
    }
    const loginUrl = new URL("/portal/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (role === "scanner") {
    if (pathname.startsWith("/workstation")) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/workstation/scan", req.url));
  }

  if (pathname.startsWith("/workstation")) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
