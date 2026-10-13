import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "exato_session";
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const PUBLIC_PATHS = ["/login", "/signup"];

/**
 * Edge-of-request concerns only: request IDs, CSP nonce, security headers,
 * a cheap "has a session cookie" redirect, and sliding cookie renewal.
 * Real authentication and authorisation happen server-side in the data layer.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  const isApi = pathname.startsWith("/api/");

  if (!isApi && !session && !PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Style attributes from Radix/Recharts require 'unsafe-inline' for styles (not scripts).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(request.nextUrl.protocol === "https:" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-request-id", requestId);

  // Sliding cookie renewal; the database row remains the source of truth for validity.
  if (session && !isApi) {
    response.cookies.set(SESSION_COOKIE, session, {
      httpOnly: true,
      secure: !isDev && process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE,
    });
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
