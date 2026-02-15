import { Prisma } from "@prisma/client";
import { TradingError, assertPositiveNumber, normalizeSymbol, requireGuestAndAccounts } from "@/lib/trading";

export const FUTURES_MMR = 0.005;
export const FUTURES_TAKER_FEE = 0.0004;
export const FUTURES_MIN_LEVERAGE = 1;
export const FUTURES_MAX_LEVERAGE = 100;

export const FUTURES_SIDE = {
  LONG: "LONG",
  SHORT: "SHORT"
} as const;

export type FuturesSide = (typeof FUTURES_SIDE)[keyof typeof FUTURES_SIDE];

export const FUTURES_ACTION = {
  OPEN: "OPEN",
  CLOSE: "CLOSE",
  LIQUIDATE: "LIQUIDATE"
} as const;

export type FuturesAction = (typeof FUTURES_ACTION)[keyof typeof FUTURES_ACTION];

export const TRANSFER_DIRECTION = {
  SPOT_TO_FUTURES: "SPOT_TO_FUTURES",
  FUTURES_TO_SPOT: "FUTURES_TO_SPOT"
} as const;

export type TransferDirection =
  (typeof TRANSFER_DIRECTION)[keyof typeof TRANSFER_DIRECTION];

export function parseFuturesSide(value: unknown): FuturesSide {
  if (value === FUTURES_SIDE.LONG || value === FUTURES_SIDE.SHORT) return value;
  throw new TradingError("side must be LONG or SHORT.");
}

export function parseTransferDirection(value: unknown): TransferDirection {
  if (value === TRANSFER_DIRECTION.SPOT_TO_FUTURES || value === TRANSFER_DIRECTION.FUTURES_TO_SPOT) {
    return value;
  }
  throw new TradingError("direction is invalid.");
}

export function validateLeverage(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TradingError("leverage must be a finite number.");
  }
  const leverage = Math.floor(parsed);
  if (leverage < FUTURES_MIN_LEVERAGE || leverage > FUTURES_MAX_LEVERAGE) {
    throw new TradingError(`leverage must be between ${FUTURES_MIN_LEVERAGE} and ${FUTURES_MAX_LEVERAGE}.`);
  }
  return leverage;
}

export function computeUnrealizedPnl(
  side: string,
  entryPrice: number,
  markPrice: number,
  qty: number
) {
  return side === FUTURES_SIDE.LONG
    ? (markPrice - entryPrice) * qty
    : (entryPrice - markPrice) * qty;
}

export function computeLiquidationPrice(
  side: FuturesSide,
  entryPrice: number,
  margin: number,
  leverage: number
) {
  const notional = margin * leverage;
  const qty = notional / entryPrice;
  const maintenance = notional * FUTURES_MMR;
  return side === FUTURES_SIDE.LONG
    ? entryPrice + (maintenance - margin) / qty
    : entryPrice - (maintenance - margin) / qty;
}

export async function ensureGuestAccounts(
  tx: Prisma.TransactionClient,
  guestId: string
) {
  if (!guestId || typeof guestId !== "string") {
    throw new TradingError("guestId is required.");
  }
  await requireGuestAndAccounts(tx, guestId.trim());
}

export function normalizeFuturesSymbol(symbol: unknown) {
  if (typeof symbol !== "string") {
    throw new TradingError("symbol is required.");
  }
  return normalizeSymbol(symbol);
}

export function parsePositiveNumber(value: unknown, fieldName: string) {
  const parsed = Number(value);
  assertPositiveNumber(parsed, fieldName);
  return parsed;
}
