import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api-response";

const EPSILON = 1e-12;
const MAX_RETRIES = 5;

function assertPositiveAmount(amount: number, field = "amount") {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError("INVALID_AMOUNT", `${field} must be a positive number.`, 400);
  }
}

export async function spendCashAtomic(tx: Prisma.TransactionClient, guestId: string, amount: number) {
  assertPositiveAmount(amount);
  const updated = await tx.account.updateMany({
    where: {
      guestId,
      cashUSDT: { gte: amount }
    },
    data: {
      cashUSDT: { decrement: amount }
    }
  });

  if (updated.count !== 1) {
    throw new ApiError("INSUFFICIENT_FUNDS", "Insufficient cashUSDT.", 409, { guestId: "redacted" });
  }
}

export async function creditCashAtomic(tx: Prisma.TransactionClient, guestId: string, amount: number) {
  assertPositiveAmount(amount);
  const updated = await tx.account.updateMany({
    where: { guestId },
    data: {
      cashUSDT: { increment: amount }
    }
  });

  if (updated.count !== 1) {
    throw new ApiError("ACCOUNT_NOT_FOUND", "Account not found.", 404);
  }
}

export async function addRealizedPnlAtomic(tx: Prisma.TransactionClient, guestId: string, delta: number) {
  if (!Number.isFinite(delta)) {
    throw new ApiError("INVALID_AMOUNT", "realizedPnl delta must be finite.", 400);
  }
  const updated = await tx.account.updateMany({
    where: { guestId },
    data: {
      realizedPnl: { increment: delta }
    }
  });

  if (updated.count !== 1) {
    throw new ApiError("ACCOUNT_NOT_FOUND", "Account not found.", 404);
  }
}

export async function spendFuturesCashAtomic(tx: Prisma.TransactionClient, guestId: string, amount: number) {
  assertPositiveAmount(amount);
  const updated = await tx.futuresAccount.updateMany({
    where: {
      guestId,
      cashUSDT: { gte: amount }
    },
    data: {
      cashUSDT: { decrement: amount }
    }
  });
  if (updated.count !== 1) {
    throw new ApiError("INSUFFICIENT_FUNDS", "Insufficient Futures cashUSDT.", 409, { guestId: "redacted" });
  }
}

export async function creditFuturesCashAtomic(tx: Prisma.TransactionClient, guestId: string, amount: number) {
  assertPositiveAmount(amount);
  const updated = await tx.futuresAccount.updateMany({
    where: { guestId },
    data: {
      cashUSDT: { increment: amount }
    }
  });
  if (updated.count !== 1) {
    throw new ApiError("ACCOUNT_NOT_FOUND", "Futures account not found.", 404);
  }
}

export async function decrementHoldingAtomic(
  tx: Prisma.TransactionClient,
  guestId: string,
  symbol: string,
  qty: number
) {
  assertPositiveAmount(qty, "qty");

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const holding = await tx.holding.findUnique({
      where: { guestId_symbol: { guestId, symbol } }
    });

    if (!holding || holding.qty + EPSILON < qty) {
      throw new ApiError("INSUFFICIENT_HOLDING", "Insufficient holding qty.", 409, { symbol });
    }

    const nextQty = holding.qty - qty;
    const normalizedQty = nextQty <= EPSILON ? 0 : nextQty;
    const normalizedAvgPrice = normalizedQty <= EPSILON ? 0 : holding.avgPrice;

    const updated = await tx.holding.updateMany({
      where: {
        id: holding.id,
        qty: holding.qty,
        avgPrice: holding.avgPrice
      },
      data: {
        qty: normalizedQty,
        avgPrice: normalizedAvgPrice
      }
    });

    if (updated.count === 1) {
      return {
        previousQty: holding.qty,
        avgPrice: holding.avgPrice,
        nextQty: normalizedQty
      };
    }
  }

  throw new ApiError("LEDGER_CONFLICT", "Holding update conflict. Please retry.", 409);
}

export async function incrementHoldingAtomic(
  tx: Prisma.TransactionClient,
  guestId: string,
  symbol: string,
  qty: number,
  price: number,
  avgPriceUpdateLogic?: (currentQty: number, currentAvgPrice: number, fillQty: number, fillPrice: number) => number
) {
  assertPositiveAmount(qty, "qty");
  assertPositiveAmount(price, "price");

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const holding = await tx.holding.findUnique({
      where: { guestId_symbol: { guestId, symbol } }
    });

    if (!holding) {
      try {
        const created = await tx.holding.create({
          data: {
            guestId,
            symbol,
            qty,
            avgPrice: price
          }
        });
        return created;
      } catch {
        continue;
      }
    }

    const newQty = holding.qty + qty;
    const newAvgPrice = avgPriceUpdateLogic
      ? avgPriceUpdateLogic(holding.qty, holding.avgPrice, qty, price)
      : (holding.qty * holding.avgPrice + qty * price) / newQty;

    const updated = await tx.holding.updateMany({
      where: {
        id: holding.id,
        qty: holding.qty,
        avgPrice: holding.avgPrice
      },
      data: {
        qty: newQty,
        avgPrice: newAvgPrice
      }
    });

    if (updated.count === 1) {
      return {
        ...holding,
        qty: newQty,
        avgPrice: newAvgPrice
      };
    }
  }

  throw new ApiError("LEDGER_CONFLICT", "Holding update conflict. Please retry.", 409);
}
