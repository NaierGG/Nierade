import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeLiquidationPrice, FUTURES_ACTION, FUTURES_MMR, FUTURES_TAKER_FEE } from "@/lib/futures";
import { resolveAccountContext } from "@/lib/account-context";
import { futuresOpenSchema } from "@/lib/schemas";
import { ApiError, errorResponse, okResponse } from "@/lib/api-response";
import { assertAllowedSymbol, getServerPrice, verifyDrift } from "@/lib/pricing";
import { requireGuestAndAccounts } from "@/lib/trading";
import { spendFuturesCash } from "@/lib/ledger";

export async function POST(request: NextRequest) {
  try {
    const body = futuresOpenSchema.parse(await request.json().catch(() => ({})));
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    const guestId = ctx.guestId;
    const symbol = await assertAllowedSymbol(body.symbol);

    const serverPrice = await getServerPrice(symbol);
    verifyDrift(body.currentPrice, serverPrice, 0.5);
    const executionPrice = serverPrice;

    const payload = await prisma.$transaction(async (tx) => {
      await requireGuestAndAccounts(tx, guestId);

      const existing = await tx.futuresPosition.findUnique({
        where: { guestId_symbol: { guestId, symbol } }
      });
      if (existing) {
        throw new ApiError("POSITION_EXISTS", "Position already exists for this symbol.", 409);
      }

      const notional = body.margin * body.leverage;
      const qty = notional / executionPrice;
      const liquidationPrice = computeLiquidationPrice(body.side, executionPrice, body.margin, body.leverage);
      const maintenance = notional * FUTURES_MMR;
      const openFee = notional * FUTURES_TAKER_FEE;
      const required = body.margin + openFee;

      await spendFuturesCash(tx, guestId, required);

      const [position, trade, account] = await Promise.all([
        tx.futuresPosition.create({
          data: {
            guestId,
            symbol,
            side: body.side,
            leverage: body.leverage,
            margin: body.margin,
            entryPrice: executionPrice,
            qty,
            liquidationPrice
          }
        }),
        tx.futuresTrade.create({
          data: {
            guestId,
            symbol,
            side: body.side,
            action: FUTURES_ACTION.OPEN,
            qty,
            price: executionPrice,
            fee: openFee,
            realizedPnl: 0
          }
        }),
        tx.futuresAccount.findUnique({ where: { guestId } })
      ]);

      return { account, position, trade, maintenance, executionPrice, serverPrice };
    });

    return okResponse(payload);
  } catch (error) {
    return errorResponse(error, "Failed to open futures position.", "FUTURES_OPEN_FAILED");
  }
}
