import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeUnrealizedPnl, FUTURES_ACTION, FUTURES_TAKER_FEE } from "@/lib/futures";
import { resolveAccountContext } from "@/lib/account-context";
import { futuresCloseSchema } from "@/lib/schemas";
import { ApiError, errorResponse, okResponse } from "@/lib/api-response";
import { assertAllowedSymbol, getServerPrice, verifyDrift } from "@/lib/pricing";
import { creditFuturesCash, spendFuturesCash } from "@/lib/ledger";
import { requireGuestAndAccounts } from "@/lib/trading";

export async function POST(request: NextRequest) {
  try {
    const body = futuresCloseSchema.parse(await request.json().catch(() => ({})));
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    const guestId = ctx.guestId;
    const symbol = await assertAllowedSymbol(body.symbol);

    const serverPrice = await getServerPrice(symbol);
    verifyDrift(body.currentPrice, serverPrice, 0.5);
    const executionPrice = serverPrice;

    const payload = await prisma.$transaction(async (tx) => {
      await requireGuestAndAccounts(tx, guestId);
      const position = await tx.futuresPosition.findUnique({
        where: { guestId_symbol: { guestId, symbol } }
      });
      if (!position) {
        throw new ApiError("POSITION_NOT_FOUND", "Futures position not found.", 404);
      }

      const realizedPnl = computeUnrealizedPnl(position.side, position.entryPrice, executionPrice, position.qty);
      const closeNotional = position.qty * executionPrice;
      const closeFee = closeNotional * FUTURES_TAKER_FEE;
      const returnToWallet = position.margin + realizedPnl - closeFee;

      if (returnToWallet >= 0) {
        await creditFuturesCash(tx, guestId, returnToWallet);
      } else {
        await spendFuturesCash(tx, guestId, Math.abs(returnToWallet));
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

      await tx.futuresPosition.delete({ where: { id: position.id } });
      const account = await tx.futuresAccount.findUnique({ where: { guestId } });

      return {
        account,
        trade,
        price: { executionPrice, serverPrice }
      };
    });

    return okResponse(payload);
  } catch (error) {
    return errorResponse(error, "Failed to close futures position.", "FUTURES_CLOSE_FAILED");
  }
}
