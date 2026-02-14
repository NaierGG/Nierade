import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureGuestAndAccount, TradingError } from "@/lib/trading";
import { errorResponse } from "@/lib/api-response";

function createGuestId() {
  return `guest_${crypto.randomUUID()}`;
}

export async function GET(request: NextRequest) {
  try {
    const _ = request;
    const guestId = createGuestId();

    await prisma.$transaction(async (tx) => {
      await ensureGuestAndAccount(tx, guestId);
    });

    return NextResponse.json(
      { ok: true, data: { guestId }, guestId },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    if (error instanceof TradingError) {
      return NextResponse.json(
        { ok: false, error: { code: "GUEST_INIT_FAILED", message: error.message } },
        { status: error.statusCode }
      );
    }
    return errorResponse(error, "Failed to initialize guest.", "GUEST_INIT_FAILED");
  }
}

export async function POST(request: NextRequest) {
  try {
    const _ = request;
    const guestId = createGuestId();

    await prisma.$transaction(async (tx) => {
      await ensureGuestAndAccount(tx, guestId);
    });

    return NextResponse.json(
      { ok: true, data: { guestId }, guestId },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    if (error instanceof TradingError) {
      return NextResponse.json(
        { ok: false, error: { code: "GUEST_INIT_FAILED", message: error.message } },
        { status: error.statusCode }
      );
    }
    return errorResponse(error, "Failed to initialize guest.", "GUEST_INIT_FAILED");
  }
}
