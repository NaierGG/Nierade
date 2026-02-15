import { Prisma } from "@prisma/client";
import {
  addSpotRealizedPnl,
  creditSpotCash,
  decrementHolding,
  incrementHoldingAndRecalcAvg,
  spendSpotCash
} from "@/lib/ledger";
import { ApiError } from "@/lib/api-response";

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

export async function createGuestAndAccounts(
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

export async function requireGuestAndAccounts(
  tx: Prisma.TransactionClient,
  guestId: string
) {
  const normalizedGuestId = guestId.trim();
  if (!normalizedGuestId) {
    throw new TradingError("guestId is required.");
  }

  const [guest, account, futuresAccount] = await Promise.all([
    tx.guest.findUnique({ where: { id: normalizedGuestId }, select: { id: true } }),
    tx.account.findUnique({ where: { guestId: normalizedGuestId }, select: { id: true } }),
    tx.futuresAccount.findUnique({ where: { guestId: normalizedGuestId }, select: { id: true } })
  ]);

  if (!guest) {
    throw new ApiError("GUEST_NOT_FOUND", "Guest not found.", 404);
  }
  if (!account) {
    throw new ApiError("ACCOUNT_NOT_FOUND", "Account not found.", 404);
  }
  if (!futuresAccount) {
    throw new ApiError("FUTURES_ACCOUNT_NOT_FOUND", "Futures account not found.", 404);
  }
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
    await spendSpotCash(tx, guestId, cost);
    await incrementHoldingAndRecalcAvg(tx, guestId, symbol, qty, price);
  } else {
    const holdingResult = await decrementHolding(tx, guestId, symbol, qty);
    const costBasis = qty * holdingResult.avgPrice;
    const proceeds = qty * price;
    const realizedDelta = proceeds - costBasis;

    await creditSpotCash(tx, guestId, proceeds);
    await addSpotRealizedPnl(tx, guestId, realizedDelta);
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
