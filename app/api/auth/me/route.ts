import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  return NextResponse.json(
    {
      ok: true,
      data: {
        user: session
          ? {
              id: session.user.id,
              email: session.user.email
            }
          : null
      }
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
