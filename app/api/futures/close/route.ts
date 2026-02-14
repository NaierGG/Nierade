import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeUnrealizedPnl, FUTURES_ACTION, FUTURES_TAKER_FEE } from "@/lib/futures";
import { ensureGuestAndAccount, TradingError } from "@/lib/trading";
import { resolveAccountContext } from "@/lib/account-context";
import { futuresCloseSchema } from "@/lib/schemas";
import { errorResponse } from "@/lib/api-response";
import { assertAllowedSymbol, resolveExecutionPrice } from "@/lib/pricing";
import { creditFuturesCashAtomic, spendFuturesCashAtomic } from "@/lib/ledger";

export async function POST(request: NextRequest) {
  try {
    const body = futuresCloseSchema.parse(await request.json().catch(() => ({})));
    const ctx = await resolveAccountContext(request, {
      allowGuest: true,
      guestId: body.guestId
    });
    const guestId = ctx.guestId;
    const symbol = await assertAllowedSymbol(body.symbol);
    const { executionPrice, serverPrice } = await resolveExecutionPrice(symbol, body.currentPrice);

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
        executionPrice,
        position.qty
      );
      const closeNotional = position.qty * executionPrice;
      const closeFee = closeNotional * FUTURES_TAKER_FEE;
      const returnToWallet = position.margin + realizedPnl - closeFee;

      if (returnToWallet >= 0) {
        await creditFuturesCashAtomic(tx, guestId, returnToWallet);
      } else {
        await spendFuturesCashAtomic(tx, guestId, Math.abs(returnToWallet));
      }

      const trade = await tx.futuresTrade.create({
        data: {
          guestId,
          symbol,
          side: position.side,
          action: FUTURES_ACTION.CLOSE,
          qty: position.qty,
          price: executionPrice,
          fee: closeFee,
          realizedPnl
        }
      });

      await tx.futuresPosition.delete({
        where: { id: position.id }
      });

      const account = await tx.futuresAccount.findUnique({
        where: { guestId }
      });

      return {
        account,
        trade,
        price: {
          executionPrice,
          serverPrice
        }
      };
    });

    return NextResponse.json({
      ok: true,
      data: payload,
      ...payload
    });
  } catch (error) {
    if (error instanceof TradingError) {
      return NextResponse.json(
        { ok: false, error: { code: "FUTURES_CLOSE_FAILED", message: error.message } },
        { status: error.statusCode }
      );
    }
    return errorResponse(error, "Failed to close futures position.", "FUTURES_CLOSE_FAILED");
  }
}
