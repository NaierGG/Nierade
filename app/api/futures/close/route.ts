import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeUnrealizedPnl, FUTURES_ACTION, FUTURES_TAKER_FEE, normalizeFuturesSymbol, parsePositiveNumber } from "@/lib/futures";
import { ensureGuestAndAccount, TradingError } from "@/lib/trading";

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

    const payload = await prisma.$transaction(async (tx) => {
      await ensureGuestAndAccount(tx, guestId);

      const position = await tx.futuresPosition.findUnique({
        where: { guestId_symbol: { guestId, symbol } }
      });
      if (!position) {
        throw new TradingError("Futures position not found.", 404);
      }

      const realizedPnl = computeUnrealizedPnl(
        position.side,
        position.entryPrice,
        currentPrice,
        position.qty
      );
      const closeNotional = position.qty * currentPrice;
      const closeFee = closeNotional * FUTURES_TAKER_FEE;
      const returnToWallet = position.margin + realizedPnl - closeFee;

      const [account, trade] = await Promise.all([
        tx.futuresAccount.update({
          where: { guestId },
          data: {
            cashUSDT: { increment: returnToWallet }
          }
        }),
        tx.futuresTrade.create({
          data: {
            guestId,
            symbol,
            side: position.side,
            action: FUTURES_ACTION.CLOSE,
            qty: position.qty,
            price: currentPrice,
            fee: closeFee,
            realizedPnl
          }
        })
      ]);

      await tx.futuresPosition.delete({
        where: { id: position.id }
      });

      return { account, trade };
    });

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof TradingError ? error.message : "Failed to close futures position.";
    const statusCode = error instanceof TradingError ? error.statusCode : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
