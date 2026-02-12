import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureGuestAndAccount, TradingError } from "@/lib/trading";

function createGuestId() {
  return `guest_${crypto.randomUUID()}`;
}

export async function GET(request: NextRequest) {
  try {
    const queryGuestId = request.nextUrl.searchParams.get("guestId");
    const guestId = queryGuestId?.trim() || createGuestId();

    await prisma.$transaction(async (tx) => {
      await ensureGuestAndAccount(tx, guestId);
    });

    return NextResponse.json(
      { guestId },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    const message =
      error instanceof TradingError ? error.message : "Failed to initialize guest.";
    const statusCode = error instanceof TradingError ? error.statusCode : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { guestId?: unknown };
    const providedGuestId =
      typeof body.guestId === "string" ? body.guestId.trim() : "";
    const guestId = providedGuestId || createGuestId();

    await prisma.$transaction(async (tx) => {
      await ensureGuestAndAccount(tx, guestId);
    });

    return NextResponse.json(
      { guestId },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    const message =
      error instanceof TradingError ? error.message : "Failed to initialize guest.";
    const statusCode = error instanceof TradingError ? error.statusCode : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
