import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, logout } from "@/lib/auth";

export async function POST(request: NextRequest) {
  await logout(request);
  const response = NextResponse.json({ ok: true, data: { loggedOut: true } });
  clearSessionCookie(response);
  return response;
}
