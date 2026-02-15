import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api-response";

const EPSILON = 1e-12;
const MAX_RETRIES = 5;

function assertPositiveAmount(amount: number, field = "amount") {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError("INVALID_AMOUNT", `${field} must be a positive number.`, 400);
  }
}

export async function spendSpotCash(tx: Prisma.TransactionClient, guestId: string, amount: number) {
  assertPositiveAmount(amount);
  const updated = await tx.account.updateMany({
    where: { guestId, cashUSDT: { gte: amount } },
    data: { cashUSDT: { decrement: amount } }
  });
  if (updated.count !== 1) {
    throw new ApiError("INSUFFICIENT_FUNDS", "Insufficient cashUSDT.", 409);
  }
}

export async function creditSpotCash(tx: Prisma.TransactionClient, guestId: string, amount: number) {
  assertPositiveAmount(amount);
  const updated = await tx.account.updateMany({
    where: { guestId },
    data: { cashUSDT: { increment: amount } }
  });
  if (updated.count !== 1) {
    throw new ApiError("ACCOUNT_NOT_FOUND", "Account not found.", 404);
  }
}

export async function addSpotRealizedPnl(tx: Prisma.TransactionClient, guestId: string, delta: number) {
  if (!Number.isFinite(delta)) {
    throw new ApiError("INVALID_AMOUNT", "realizedPnl delta must be finite.", 400);
  }
  const updated = await tx.account.updateMany({
    where: { guestId },
    data: { realizedPnl: { increment: delta } }
  });
  if (updated.count !== 1) {
    throw new ApiError("ACCOUNT_NOT_FOUND", "Account not found.", 404);
  }
}

export async function decrementHolding(
  tx: Prisma.TransactionClient,
  guestId: string,
  symbol: string,
  qty: number
) {
  assertPositiveAmount(qty, "qty");
  const updated = await tx.holding.updateMany({
    where: { guestId, symbol, qty: { gte: qty } },
    data: { qty: { decrement: qty } }
  });
  if (updated.count !== 1) {
    throw new ApiError("INSUFFICIENT_HOLDING", "Insufficient holding qty.", 409, { symbol });
  }

  const holding = await tx.holding.findUnique({
    where: { guestId_symbol: { guestId, symbol } }
  });
  if (!holding) {
    throw new ApiError("HOLDING_NOT_FOUND", "Holding not found.", 404);
  }

  if (holding.qty <= EPSILON) {
    const normalized = await tx.holding.updateMany({
      where: { id: holding.id, qty: holding.qty, avgPrice: holding.avgPrice },
      data: { qty: 0, avgPrice: 0 }
    });
    if (normalized.count === 1) {
      return { previousQty: qty + holding.qty, avgPrice: holding.avgPrice, nextQty: 0 };
    }
  }

  return {
    previousQty: holding.qty + qty,
    avgPrice: holding.avgPrice,
    nextQty: holding.qty
  };
}

export async function incrementHoldingAndRecalcAvg(
  tx: Prisma.TransactionClient,
  guestId: string,
  symbol: string,
  qty: number,
  price: number
) {
  assertPositiveAmount(qty, "qty");
  assertPositiveAmount(price, "price");

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const current = await tx.holding.findUnique({
      where: { guestId_symbol: { guestId, symbol } }
    });

    if (!current) {
      try {
        return await tx.holding.create({
          data: { guestId, symbol, qty, avgPrice: price }
        });
      } catch {
        continue;
      }
    }

    const nextQty = current.qty + qty;
    const nextAvgPrice = (current.qty * current.avgPrice + qty * price) / nextQty;
    const updated = await tx.holding.updateMany({
      where: { id: current.id, qty: current.qty, avgPrice: current.avgPrice },
      data: { qty: nextQty, avgPrice: nextAvgPrice }
    });

    if (updated.count === 1) {
      return {
        ...current,
        qty: nextQty,
        avgPrice: nextAvgPrice
      };
    }
  }

  throw new ApiError("LEDGER_CONFLICT", "Holding update conflict. Please retry.", 409);
}

export async function spendFuturesCash(tx: Prisma.TransactionClient, guestId: string, amount: number) {
  assertPositiveAmount(amount);
  const updated = await tx.futuresAccount.updateMany({
    where: { guestId, cashUSDT: { gte: amount } },
    data: { cashUSDT: { decrement: amount } }
  });
  if (updated.count !== 1) {
    throw new ApiError("INSUFFICIENT_FUNDS", "Insufficient futures cashUSDT.", 409);
  }
}

export async function creditFuturesCash(tx: Prisma.TransactionClient, guestId: string, amount: number) {
  assertPositiveAmount(amount);
  const updated = await tx.futuresAccount.updateMany({
    where: { guestId },
    data: { cashUSDT: { increment: amount } }
  });
  if (updated.count !== 1) {
    throw new ApiError("ACCOUNT_NOT_FOUND", "Futures account not found.", 404);
  }
}

// Backward-compatible aliases.
export const spendCashAtomic = spendSpotCash;
export const creditCashAtomic = creditSpotCash;
export const addRealizedPnlAtomic = addSpotRealizedPnl;
export const decrementHoldingAtomic = decrementHolding;
export const incrementHoldingAtomic = incrementHoldingAndRecalcAvg;
export const spendFuturesCashAtomic = spendFuturesCash;
export const creditFuturesCashAtomic = creditFuturesCash;
