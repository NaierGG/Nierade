import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decimalPlaces, isDecimalString } from "@/lib/money";
import { parseTransferDirection, TRANSFER_DIRECTION } from "@/lib/futures";
import { requireGuestAndAccounts, TradingError } from "@/lib/trading";
import { resolveAccountContext } from "@/lib/account-context";
import { transferSchema } from "@/lib/schemas";
import { errorResponse, okResponse } from "@/lib/api-response";
import { creditFuturesCash, creditSpotCash, spendFuturesCash, spendSpotCash } from "@/lib/ledger";

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
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    const guestId = ctx.guestId;
    const direction = parseTransferDirection(body.direction);
    const amount = parseTransferAmount(body.amount).toNumber();

    await prisma.$transaction(async (tx) => {
      await requireGuestAndAccounts(tx, guestId);

      if (direction === TRANSFER_DIRECTION.SPOT_TO_FUTURES) {
        await spendSpotCash(tx, guestId, amount);
        await creditFuturesCash(tx, guestId, amount);
        return;
      }

      await spendFuturesCash(tx, guestId, amount);
      await creditSpotCash(tx, guestId, amount);
    });

    return okResponse({ transferred: true });
  } catch (error) {
    if (error instanceof TradingError) {
      return errorResponse(error, "Failed to transfer funds.", "TRANSFER_FAILED");
    }
    return errorResponse(error, "Failed to transfer funds.", "TRANSFER_FAILED");
  }
}
