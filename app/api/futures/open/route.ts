import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeLiquidationPrice,
  FUTURES_ACTION,
  FUTURES_MMR,
  FUTURES_TAKER_FEE
} from "@/lib/futures";
import { ensureGuestAndAccount, TradingError } from "@/lib/trading";
import { resolveAccountContext } from "@/lib/account-context";
import { futuresOpenSchema } from "@/lib/schemas";
import { errorResponse } from "@/lib/api-response";
import { assertAllowedSymbol, resolveExecutionPrice } from "@/lib/pricing";
import { spendFuturesCashAtomic } from "@/lib/ledger";

export async function POST(request: NextRequest) {
  try {
    const body = futuresOpenSchema.parse(await request.json().catch(() => ({})));
    const ctx = await resolveAccountContext(request, {
      allowGuest: true,
      guestId: body.guestId
    });
    const guestId = ctx.guestId;
    const symbol = await assertAllowedSymbol(body.symbol);
    const side = body.side;
    const leverage = body.leverage;
    const margin = body.margin;
    const { executionPrice, serverPrice } = await resolveExecutionPrice(symbol, body.currentPrice);

    const payload = await prisma.$transaction(async (tx) => {
      await ensureGuestAndAccount(tx, guestId);

      const existing = await tx.futuresPosition.findUnique({
        where: { guestId_symbol: { guestId, symbol } }
      });
      if (existing) {
        throw new TradingError("Position already exists for this symbol.");
      }

      const notional = margin * leverage;
      const qty = notional / executionPrice;
      const maintenance = notional * FUTURES_MMR;
      const liquidationPrice = computeLiquidationPrice(side, executionPrice, margin, leverage);
      const openFee = notional * FUTURES_TAKER_FEE;
      const required = margin + openFee;

      await spendFuturesCashAtomic(tx, guestId, required);

      const [position, trade, account] = await Promise.all([
        tx.futuresPosition.create({
          data: {
            guestId,
            symbol,
            side,
            leverage,
            margin,
            entryPrice: executionPrice,
            qty,
            liquidationPrice
          }
        }),
        tx.futuresTrade.create({
          data: {
            guestId,
            symbol,
            side,
            action: FUTURES_ACTION.OPEN,
            qty,
            price: executionPrice,
            fee: openFee,
            realizedPnl: 0
          }
        }),
        tx.futuresAccount.findUnique({
          where: { guestId }
        })
      ]);

      return { account, position, trade, maintenance, executionPrice, serverPrice };
    });

    return NextResponse.json({
      ok: true,
      data: payload,
      ...payload
    });
  } catch (error) {
    if (error instanceof TradingError) {
      return NextResponse.json(
        { ok: false, error: { code: "FUTURES_OPEN_FAILED", message: error.message } },
        { status: error.statusCode }
      );
    }
    return errorResponse(error, "Failed to open futures position.", "FUTURES_OPEN_FAILED");
  }
}
