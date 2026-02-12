import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeFuturesSymbol } from "@/lib/futures";
import { TradingError } from "@/lib/trading";

export async function GET(request: NextRequest) {
  try {
    const guestId = request.nextUrl.searchParams.get("guestId")?.trim();
    const rawSymbol = request.nextUrl.searchParams.get("symbol");
    if (!guestId) {
      throw new TradingError("guestId is required.");
    }
    const symbol = normalizeFuturesSymbol(rawSymbol);

    const position = await prisma.futuresPosition.findUnique({
      where: {
        guestId_symbol: { guestId, symbol }
      }
    });

    return NextResponse.json({ position });
  } catch (error) {
    const message = error instanceof TradingError ? error.message : "Failed to fetch position.";
    const statusCode = error instanceof TradingError ? error.statusCode : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
