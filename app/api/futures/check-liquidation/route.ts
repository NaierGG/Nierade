import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeUnrealizedPnl,
  FUTURES_ACTION,
  FUTURES_MMR,
  normalizeFuturesSymbol,
  parsePositiveNumber
} from "@/lib/futures";
import { TradingError } from "@/lib/trading";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      guestId?: unknown;
      symbol?: unknown;
      currentPrice?: unknown;
    };

    const guestId = typeof body.guestId === "string" ? body.guestId.trim() : "";
    if (!guestId) {
      throw new TradingError("guestId is required.");
    }
    const symbol = normalizeFuturesSymbol(body.symbol);
    const currentPrice = parsePositiveNumber(body.currentPrice, "currentPrice");

    const result = await prisma.$transaction(async (tx) => {
      const position = await tx.futuresPosition.findUnique({
        where: { guestId_symbol: { guestId, symbol } }
      });
      if (!position) {
        return { liquidated: false };
      }

      const notional = position.margin * position.leverage;
      const maintenance = notional * FUTURES_MMR;
      const unrealizedPnl = computeUnrealizedPnl(
        position.side,
        position.entryPrice,
        currentPrice,
        position.qty
      );
      const equity = position.margin + unrealizedPnl;

      if (equity > maintenance) {
        return { liquidated: false };
      }

      await tx.futuresPosition.delete({
        where: { id: position.id }
      });
      await tx.futuresTrade.create({
        data: {
          guestId,
          symbol,
          side: position.side,
          action: FUTURES_ACTION.LIQUIDATE,
          qty: position.qty,
          price: currentPrice,
          fee: 0,
          realizedPnl: -position.margin
        }
      });

      // V1 liquidation is harsh by design: no wallet refund on liquidation.
      return { liquidated: true };
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof TradingError ? error.message : "Failed to check liquidation.";
    const statusCode = error instanceof TradingError ? error.statusCode : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
