import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeLiquidationPrice } from "@/lib/futures";
import { resolveAccountContext } from "@/lib/account-context";
import { futuresAddMarginSchema } from "@/lib/schemas";
import { ApiError, errorResponse, okResponse } from "@/lib/api-response";
import { assertAllowedSymbol } from "@/lib/pricing";
import { spendFuturesCash } from "@/lib/ledger";
import { requireGuestAndAccounts } from "@/lib/trading";

export async function POST(request: NextRequest) {
  try {
    const body = futuresAddMarginSchema.parse(await request.json().catch(() => ({})));
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    const guestId = ctx.guestId;
    const symbol = await assertAllowedSymbol(body.symbol);

    const result = await prisma.$transaction(async (tx) => {
      await requireGuestAndAccounts(tx, guestId);
      const position = await tx.futuresPosition.findUnique({
        where: { guestId_symbol: { guestId, symbol } }
      });
      if (!position) {
        throw new ApiError("POSITION_NOT_FOUND", "Futures position not found.", 404);
      }

      await spendFuturesCash(tx, guestId, body.addAmount);
      const nextMargin = position.margin + body.addAmount;
      const liquidationPrice = computeLiquidationPrice(
        position.side as "LONG" | "SHORT",
        position.entryPrice,
        nextMargin,
        position.leverage
      );

      const updatedPosition = await tx.futuresPosition.update({
        where: { id: position.id },
        data: {
          margin: nextMargin,
          liquidationPrice
        }
      });
      const account = await tx.futuresAccount.findUnique({ where: { guestId } });
      return { position: updatedPosition, account };
    });

    return okResponse(result);
  } catch (error) {
    return errorResponse(error, "Failed to add margin.", "FUTURES_ADD_MARGIN_FAILED");
  }
}
