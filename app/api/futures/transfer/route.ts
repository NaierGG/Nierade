import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decimalPlaces, isDecimalString } from "@/lib/money";
import { parseTransferDirection, TRANSFER_DIRECTION } from "@/lib/futures";
import { TradingError, ensureGuestAndAccount } from "@/lib/trading";
import { resolveAccountContext } from "@/lib/account-context";
import { transferSchema } from "@/lib/schemas";
import { errorResponse } from "@/lib/api-response";
import { creditCashAtomic, creditFuturesCashAtomic, spendCashAtomic, spendFuturesCashAtomic } from "@/lib/ledger";

const TRANSFER_MIN_USDT = process.env.TRANSFER_MIN_USDT ?? "0.01";
const TRANSFER_MAX_DECIMALS = 6;

function parseTransferAmount(amount: unknown) {
  const amountText = typeof amount === "string" ? amount.trim() : String(amount ?? "").trim();
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
    const body = transferSchema.parse(await request.json().catch(() => ({})));
    const ctx = await resolveAccountContext(request, {
      allowGuest: true,
      guestId: body.guestId
    });
    const guestId = ctx.guestId;
    const direction = parseTransferDirection(body.direction);
    const amount = parseTransferAmount(body.amount).toNumber();

    await prisma.$transaction(async (tx) => {
      await ensureGuestAndAccount(tx, guestId);

      if (direction === TRANSFER_DIRECTION.SPOT_TO_FUTURES) {
        await spendCashAtomic(tx, guestId, amount);
        await creditFuturesCashAtomic(tx, guestId, amount);
        return;
      }

      await spendFuturesCashAtomic(tx, guestId, amount);
      await creditCashAtomic(tx, guestId, amount);
    });

    return NextResponse.json({ ok: true, data: { transferred: true } });
  } catch (error) {
    if (error instanceof TradingError) {
      return NextResponse.json(
        { ok: false, error: { code: "TRANSFER_FAILED", message: error.message } },
        { status: error.statusCode >= 500 ? error.statusCode : 400 }
      );
    }
    return errorResponse(error, "Failed to transfer funds.", "TRANSFER_FAILED");
  }
}
