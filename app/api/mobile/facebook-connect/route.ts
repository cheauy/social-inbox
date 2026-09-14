import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import { memberHasPermission } from "@/lib/auth/require-permission";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const auth = await getCurrentMember();
  if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });
  if (!(await memberHasPermission(auth.member, "channels", "manage"))) return NextResponse.json({ error: "Channel management permission required." }, { status: 403 });
  // Establish the authenticated native session in this isolated WebView cookie jar.
  // No credentials are placed in a URL or exposed to page JavaScript.
  const response = NextResponse.redirect(new URL("/api/facebook/oauth/connect", request.url));
  const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  const name = `sb-${project}-auth-token`;
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name === name || (cookie.name.startsWith(name + ".") && /^\d+$/.test(cookie.name.slice(name.length + 1)))) {
      response.cookies.set(cookie.name, cookie.value, { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 600 });
    }
  }
  response.cookies.set("tenh_active_business_id", auth.member.business_id, { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 600 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
