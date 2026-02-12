import { Prisma } from "@prisma/client";

export const ORDER_SIDE = {
  BUY: "BUY",
  SELL: "SELL"
} as const;

export type OrderSide = (typeof ORDER_SIDE)[keyof typeof ORDER_SIDE];

export const ORDER_TYPE = {
  MARKET: "MARKET",
  LIMIT: "LIMIT"
} as const;

export type OrderType = (typeof ORDER_TYPE)[keyof typeof ORDER_TYPE];

export const ORDER_STATUS = {
  OPEN: "OPEN",
  FILLED: "FILLED",
  CANCELED: "CANCELED"
} as const;

export class TradingError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "TradingError";
  }
}

export function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

export function assertPositiveNumber(value: unknown, fieldName: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TradingError(`${fieldName} must be a positive number.`);
  }
}

export async function ensureGuestAndAccount(
  tx: Prisma.TransactionClient,
  guestId: string
) {
  await tx.guest.upsert({
    where: { id: guestId },
    update: {},
    create: { id: guestId }
  });

  await tx.account.upsert({
    where: { guestId },
    update: {},
    create: { guestId }
  });

  await tx.futuresAccount.upsert({
    where: { guestId },
    update: {},
    create: { guestId }
  });
}

interface ApplyFillInput {
  guestId: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number;
  orderId?: string;
}

export async function applyFill(
  tx: Prisma.TransactionClient,
  input: ApplyFillInput
) {
  const { guestId, symbol, side, qty, price, orderId } = input;

  const account = await tx.account.findUnique({
    where: { guestId }
  });

  if (!account) {
    throw new TradingError("Account not found for guestId.", 404);
  }

  if (side === ORDER_SIDE.BUY) {
    const cost = qty * price;
    if (account.cashUSDT < cost) {
      throw new TradingError("Insufficient cashUSDT for BUY order.");
    }

    await tx.account.update({
      where: { guestId },
      data: { cashUSDT: { decrement: cost } }
    });

    const existing = await tx.holding.findUnique({
      where: { guestId_symbol: { guestId, symbol } }
    });

    if (!existing) {
      await tx.holding.create({
        data: {
          guestId,
          symbol,
          qty,
          avgPrice: price
        }
      });
    } else {
      const newQty = existing.qty + qty;
      const newAvgPrice =
        (existing.qty * existing.avgPrice + qty * price) / newQty;

      await tx.holding.update({
        where: { id: existing.id },
        data: {
          qty: newQty,
          avgPrice: newAvgPrice
        }
      });
    }
  } else {
    const holding = await tx.holding.findUnique({
      where: { guestId_symbol: { guestId, symbol } }
    });

    if (!holding || holding.qty < qty) {
      throw new TradingError("Insufficient holding qty for SELL order.");
    }

    const costBasis = qty * holding.avgPrice;
    const proceeds = qty * price;
    const realizedDelta = proceeds - costBasis;

    await tx.account.update({
      where: { guestId },
      data: {
        cashUSDT: { increment: proceeds },
        realizedPnl: { increment: realizedDelta }
      }
    });

    const remainingQty = holding.qty - qty;
    if (remainingQty <= 1e-12) {
      await tx.holding.update({
        where: { id: holding.id },
        data: { qty: 0, avgPrice: 0 }
      });
    } else {
      await tx.holding.update({
        where: { id: holding.id },
        data: { qty: remainingQty }
      });
    }
  }

  if (orderId) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: ORDER_STATUS.FILLED }
    });
  }

  const trade = await tx.trade.create({
    data: {
      guestId,
      symbol,
      side,
      qty,
      price,
      orderId
    }
  });

  return trade;
}

export async function assertSufficientBalanceOrHolding(
  tx: Prisma.TransactionClient,
  guestId: string,
  symbol: string,
  side: OrderSide,
  qty: number,
  price: number
) {
  const account = await tx.account.findUnique({
    where: { guestId }
  });
  if (!account) {
    throw new TradingError("Account not found for guestId.", 404);
  }

  if (side === ORDER_SIDE.BUY) {
    const cost = qty * price;
    if (account.cashUSDT < cost) {
      throw new TradingError("Insufficient cashUSDT for BUY order.");
    }
    return;
  }

  const holding = await tx.holding.findUnique({
    where: { guestId_symbol: { guestId, symbol } }
  });

  if (!holding || holding.qty < qty) {
    throw new TradingError("Insufficient holding qty for SELL order.");
  }
}

export function canLimitOrderFill(
  side: OrderSide,
  limitPrice: number,
  currentPrice: number
) {
  if (side === ORDER_SIDE.BUY) {
    return currentPrice <= limitPrice;
  }
  return currentPrice >= limitPrice;
}

interface NewOrderInput {
  guestId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
  currentPrice?: number;
}

export function validateNewOrderInput(input: NewOrderInput) {
  const { guestId, symbol, side, type, qty, limitPrice, currentPrice } = input;
  if (!guestId || typeof guestId !== "string") {
    throw new TradingError("guestId is required.");
  }
  if (!symbol || typeof symbol !== "string") {
    throw new TradingError("symbol is required.");
  }
  if (side !== ORDER_SIDE.BUY && side !== ORDER_SIDE.SELL) {
    throw new TradingError("side must be BUY or SELL.");
  }
  if (type !== ORDER_TYPE.MARKET && type !== ORDER_TYPE.LIMIT) {
    throw new TradingError("type must be MARKET or LIMIT.");
  }
  assertPositiveNumber(qty, "qty");

  if (type === ORDER_TYPE.MARKET) {
    assertPositiveNumber(currentPrice, "currentPrice");
  } else {
    assertPositiveNumber(limitPrice, "limitPrice");
  }
}
