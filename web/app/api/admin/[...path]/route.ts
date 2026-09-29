import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, webhookUrl } from "@/lib/adminServer";

// Forwards admin dashboard requests to the webhook server's JWT-protected API,
// attaching the session token from the httpOnly cookie.
async function proxy(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { path } = await ctx.params;
  const search = new URL(request.url).search;
  const target = `${webhookUrl()}/admin/api/${path.map(encodeURIComponent).join("/")}${search}`;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const upstream = await fetch(target, {
    method: request.method,
    headers: { Authorization: `Bearer ${token}`, ...(hasBody ? { "Content-Type": "application/json" } : {}) },
    body: hasBody ? await request.text() : undefined,
    cache: "no-store",
  }).catch(() => null);

  if (!upstream) return NextResponse.json({ error: "Admin service unavailable" }, { status: 502 });
  const res = new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  });
  if (upstream.status === 401) res.cookies.delete(ADMIN_COOKIE);
  return res;
}

export { proxy as GET, proxy as POST, proxy as PATCH };
