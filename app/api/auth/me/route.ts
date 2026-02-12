import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { user: null },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }

  return NextResponse.json(
    {
      user: {
        id: session.user.id,
        email: session.user.email
      }
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
