import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeUnrealizedPnl,
  FUTURES_ACTION,
  FUTURES_MMR
} from "@/lib/futures";
import { resolveAccountContext } from "@/lib/account-context";
import { futuresLiquidationSchema } from "@/lib/schemas";
import { errorResponse } from "@/lib/api-response";
import { assertAllowedSymbol, resolveExecutionPrice } from "@/lib/pricing";

export async function POST(request: NextRequest) {
  try {
    const body = futuresLiquidationSchema.parse(await request.json().catch(() => ({})));
    const ctx = await resolveAccountContext(request, {
      allowGuest: true,
      guestId: body.guestId
    });
    const guestId = ctx.guestId;
    const symbol = await assertAllowedSymbol(body.symbol);
    const { executionPrice, serverPrice } = await resolveExecutionPrice(symbol, body.currentPrice);

    const result = await prisma.$transaction(async (tx) => {
      const position = await tx.futuresPosition.findUnique({
        where: { guestId_symbol: { guestId, symbol } }
      });
      if (!position) {
        return { liquidated: false, price: { executionPrice, serverPrice } };
      }

      const notional = position.margin * position.leverage;
      const maintenance = notional * FUTURES_MMR;
      const unrealizedPnl = computeUnrealizedPnl(
        position.side,
        position.entryPrice,
        executionPrice,
        position.qty
      );
      const equity = position.margin + unrealizedPnl;

      if (equity > maintenance) {
        return { liquidated: false, price: { executionPrice, serverPrice } };
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
          price: executionPrice,
          fee: 0,
          realizedPnl: -position.margin
        }
      });

      return { liquidated: true, price: { executionPrice, serverPrice } };
    });

    return NextResponse.json({ ok: true, data: result, ...result });
  } catch (error) {
    return errorResponse(error, "Failed to check liquidation.", "LIQUIDATION_CHECK_FAILED");
  }
}
