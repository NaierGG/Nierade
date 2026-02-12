import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parsePositiveNumber, parseTransferDirection, TRANSFER_DIRECTION } from "@/lib/futures";
import { TradingError, ensureGuestAndAccount } from "@/lib/trading";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      guestId?: unknown;
      direction?: unknown;
      amount?: unknown;
    };

    const guestId = typeof body.guestId === "string" ? body.guestId.trim() : "";
    if (!guestId) {
      throw new TradingError("guestId is required.");
    }

    const direction = parseTransferDirection(body.direction);
    const amount = parsePositiveNumber(body.amount, "amount");

    const result = await prisma.$transaction(async (tx) => {
      await ensureGuestAndAccount(tx, guestId);

      const [spot, futures] = await Promise.all([
        tx.account.findUnique({ where: { guestId } }),
        tx.futuresAccount.findUnique({ where: { guestId } })
      ]);

      if (!spot || !futures) {
        throw new TradingError("Accounts not found.", 404);
      }

      if (direction === TRANSFER_DIRECTION.SPOT_TO_FUTURES) {
        if (spot.cashUSDT < amount) {
          throw new TradingError("Insufficient Spot cashUSDT.");
        }
        const [nextSpot, nextFutures] = await Promise.all([
          tx.account.update({
            where: { guestId },
            data: { cashUSDT: { decrement: amount } }
          }),
          tx.futuresAccount.update({
            where: { guestId },
            data: { cashUSDT: { increment: amount } }
          })
        ]);
        return { spot: nextSpot, futures: nextFutures };
      }

      if (futures.cashUSDT < amount) {
        throw new TradingError("Insufficient Futures cashUSDT.");
      }
      const [nextSpot, nextFutures] = await Promise.all([
        tx.account.update({
          where: { guestId },
          data: { cashUSDT: { increment: amount } }
        }),
        tx.futuresAccount.update({
          where: { guestId },
          data: { cashUSDT: { decrement: amount } }
        })
      ]);
      return { spot: nextSpot, futures: nextFutures };
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof TradingError ? error.message : "Failed to transfer funds.";
    const statusCode = error instanceof TradingError ? error.statusCode : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
