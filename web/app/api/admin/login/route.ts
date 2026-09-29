import { NextResponse } from "next/server";
import { ADMIN_COOKIE, SESSION_SECONDS, webhookUrl } from "@/lib/adminServer";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const upstream = await fetch(`${webhookUrl()}/admin/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": request.headers.get("x-forwarded-for") ?? "" },
    body: JSON.stringify({ email: body.email, password: body.password }),
    cache: "no-store",
  }).catch(() => null);

  if (!upstream) return NextResponse.json({ error: "Admin service unavailable" }, { status: 502 });
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) return NextResponse.json({ error: data.error ?? "Sign-in failed" }, { status: upstream.status });

  const res = NextResponse.json({ email: data.email });
  res.cookies.set(ADMIN_COOKIE, data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return res;
}
