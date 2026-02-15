import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeUnrealizedPnl, FUTURES_ACTION, FUTURES_MMR, FUTURES_TAKER_FEE } from "@/lib/futures";
import { resolveAccountContext } from "@/lib/account-context";
import { futuresLiquidationSchema } from "@/lib/schemas";
import { errorResponse, okResponse } from "@/lib/api-response";
import { assertAllowedSymbol, getServerPrice, verifyDrift } from "@/lib/pricing";
import { creditFuturesCash } from "@/lib/ledger";
import { requireGuestAndAccounts } from "@/lib/trading";

const FUTURES_LIQUIDATION_FEE =
  Number(process.env.FUTURES_LIQUIDATION_FEE ?? Number.NaN) > 0
    ? Number(process.env.FUTURES_LIQUIDATION_FEE)
    : FUTURES_TAKER_FEE;

export async function POST(request: NextRequest) {
  try {
    const body = futuresLiquidationSchema.parse(await request.json().catch(() => ({})));
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    const guestId = ctx.guestId;
    const symbol = await assertAllowedSymbol(body.symbol);

    const serverPrice = await getServerPrice(symbol);
    verifyDrift(body.currentPrice, serverPrice, 0.5);
    const executionPrice = serverPrice;

    const result = await prisma.$transaction(async (tx) => {
      await requireGuestAndAccounts(tx, guestId);

      const position = await tx.futuresPosition.findUnique({
        where: { guestId_symbol: { guestId, symbol } }
      });
      if (!position) {
        return { liquidated: false, refund: 0, fee: 0, price: { executionPrice, serverPrice } };
      }

      const notional = position.margin * position.leverage;
      const maintenance = notional * FUTURES_MMR;
      const unrealizedPnl = computeUnrealizedPnl(position.side, position.entryPrice, executionPrice, position.qty);
      const equity = position.margin + unrealizedPnl;

      if (equity > maintenance) {
        return { liquidated: false, refund: 0, fee: 0, price: { executionPrice, serverPrice } };
      }

      const liquidationFee = notional * FUTURES_LIQUIDATION_FEE;
      const refund = Math.max(0, equity - liquidationFee);

      await tx.futuresPosition.delete({ where: { id: position.id } });
      if (refund > 0) {
        await creditFuturesCash(tx, guestId, refund);
      }
      await tx.futuresTrade.create({
        data: {
          guestId,
          symbol,
          side: position.side,
          action: FUTURES_ACTION.LIQUIDATE,
          qty: position.qty,
          price: executionPrice,
          fee: liquidationFee,
          realizedPnl: refund - position.margin
        }
      });

      return { liquidated: true, refund, fee: liquidationFee, price: { executionPrice, serverPrice } };
    });

    return okResponse(result);
  } catch (error) {
    return errorResponse(error, "Failed to check liquidation.", "LIQUIDATION_CHECK_FAILED");
  }
}
