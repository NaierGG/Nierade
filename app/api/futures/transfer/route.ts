import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decimalPlaces, isDecimalString } from "@/lib/money";
import { parseTransferDirection, TRANSFER_DIRECTION } from "@/lib/futures";
import { TradingError, ensureGuestAndAccount } from "@/lib/trading";

const TRANSFER_MIN_USDT = process.env.TRANSFER_MIN_USDT ?? "0.01";
const TRANSFER_MAX_DECIMALS = 6;

type TransferErrorCode =
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_FUNDS"
  | "ACCOUNT_NOT_FOUND"
  | "INTERNAL";

function transferError(code: TransferErrorCode, message: string, statusCode = 400) {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message }
    },
    { status: statusCode }
  );
}

function parseTransferAmount(amount: unknown) {
  const amountText = typeof amount === "string" ? amount.trim() : "";
  if (!amountText || !isDecimalString(amountText)) {
    throw new TradingError("amount must be a decimal string.");
  }
  if (decimalPlaces(amountText) > TRANSFER_MAX_DECIMALS) {
    throw new TradingError(`amount can have up to ${TRANSFER_MAX_DECIMALS} decimal places.`);
  }

  let decimalAmount: Prisma.Decimal;
  try {
    decimalAmount = new Prisma.Decimal(amountText);
  } catch {
    throw new TradingError("amount is invalid.");
  }

  if (!decimalAmount.isFinite() || decimalAmount.lte(0)) {
    throw new TradingError("amount must be greater than 0.");
  }

  const minAmount = new Prisma.Decimal(TRANSFER_MIN_USDT);
  if (decimalAmount.lt(minAmount)) {
    throw new TradingError(`Minimum transfer amount is ${minAmount.toString()} USDT.`);
  }

  return decimalAmount;
}

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
    const amount = parseTransferAmount(body.amount);

    await prisma.$transaction(async (tx) => {
      await ensureGuestAndAccount(tx, guestId);

      const [spot, futures] = await Promise.all([
        tx.account.findUnique({ where: { guestId } }),
        tx.futuresAccount.findUnique({ where: { guestId } })
      ]);

      if (!spot || !futures) {
        throw new TradingError("Accounts not found.", 404);
      }

      const spotCash = new Prisma.Decimal(String(spot.cashUSDT));
      const futuresCash = new Prisma.Decimal(String(futures.cashUSDT));
      const now = new Date();

      if (direction === TRANSFER_DIRECTION.SPOT_TO_FUTURES) {
        if (spotCash.lt(amount)) {
          throw new TradingError("Insufficient Spot cashUSDT.");
        }

        const nextSpotCash = spotCash.sub(amount);
        const nextFuturesCash = futuresCash.add(amount);
        await Promise.all([
          tx.account.update({
            where: { guestId },
            data: {
              cashUSDT: nextSpotCash.toNumber(),
              updatedAt: now
            }
          }),
          tx.futuresAccount.update({
            where: { guestId },
            data: {
              cashUSDT: nextFuturesCash.toNumber(),
              updatedAt: now
            }
          })
        ]);
        return;
      }

      if (futuresCash.lt(amount)) {
        throw new TradingError("Insufficient Futures cashUSDT.");
      }

      const nextSpotCash = spotCash.add(amount);
      const nextFuturesCash = futuresCash.sub(amount);
      await Promise.all([
        tx.account.update({
          where: { guestId },
          data: {
            cashUSDT: nextSpotCash.toNumber(),
            updatedAt: now
          }
        }),
        tx.futuresAccount.update({
          where: { guestId },
          data: {
            cashUSDT: nextFuturesCash.toNumber(),
            updatedAt: now
          }
        })
      ]);
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TradingError) {
      if (error.statusCode === 404) {
        return transferError("ACCOUNT_NOT_FOUND", error.message, 404);
      }

      if (error.message.includes("Insufficient")) {
        return transferError("INSUFFICIENT_FUNDS", error.message, 400);
      }

      if (error.statusCode < 500) {
        return transferError("INVALID_AMOUNT", error.message, 400);
      }

      return transferError("INTERNAL", error.message, error.statusCode);
    }

    return transferError("INTERNAL", "Failed to transfer funds.", 500);
  }
}
