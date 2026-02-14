import { Prisma } from "@prisma/client";
import { addRealizedPnlAtomic, creditCashAtomic, decrementHoldingAtomic, incrementHoldingAtomic, spendCashAtomic } from "@/lib/ledger";

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
  const normalizedGuestId = guestId.trim();
  if (!normalizedGuestId) {
    throw new TradingError("guestId is required.");
  }

  await tx.guest.upsert({
    where: { id: normalizedGuestId },
    update: {},
    create: { id: normalizedGuestId }
  });

  await Promise.all([
    tx.account.upsert({
      where: { guestId: normalizedGuestId },
      update: {},
      create: { guestId: normalizedGuestId }
    }),
    tx.futuresAccount.upsert({
      where: { guestId: normalizedGuestId },
      update: {},
      create: { guestId: normalizedGuestId }
    })
  ]);
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

  if (side === ORDER_SIDE.BUY) {
    const cost = qty * price;
    await spendCashAtomic(tx, guestId, cost);
    await incrementHoldingAtomic(tx, guestId, symbol, qty, price);
  } else {
    const holdingResult = await decrementHoldingAtomic(tx, guestId, symbol, qty);
    const costBasis = qty * holdingResult.avgPrice;
    const proceeds = qty * price;
    const realizedDelta = proceeds - costBasis;

    await creditCashAtomic(tx, guestId, proceeds);
    await addRealizedPnlAtomic(tx, guestId, realizedDelta);
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
  if (side === ORDER_SIDE.BUY) {
    const cost = qty * price;
    const account = await tx.account.findUnique({
      where: { guestId },
      select: { cashUSDT: true }
    });
    if (!account) {
      throw new TradingError("Account not found for guestId.", 404);
    }
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
