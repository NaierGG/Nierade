import { z } from "zod";

export const GUEST_ID_RE = /^guest_[0-9a-fA-F-]{36}$/;

export const guestIdSchema = z
  .string()
  .trim()
  .regex(GUEST_ID_RE, "guestId must match guest_<uuid> format.");

export const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{3,20}$/, "symbol format is invalid.");

export const qtySchema = z.coerce.number().finite().positive().max(1_000_000);
export const priceSchema = z.coerce.number().finite().positive().max(10_000_000);
export const leverageSchema = z.coerce.number().int().min(1).max(100);

export const orderQuerySchema = z.object({
  guestId: z.string().trim().optional()
});

export const createOrderSchema = z.object({
  guestId: z.string().trim().optional(),
  symbol: symbolSchema,
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT"]),
  qty: qtySchema,
  limitPrice: priceSchema.optional(),
  currentPrice: priceSchema.optional()
});

export const fillOrderSchema = z.object({
  guestId: z.string().trim().optional(),
  orderId: z.string().trim().min(1),
  currentPrice: priceSchema.optional()
});

export const cancelOrderSchema = z.object({
  guestId: z.string().trim().optional(),
  orderId: z.string().trim().min(1)
});

export const futuresOpenSchema = z.object({
  guestId: z.string().trim().optional(),
  symbol: symbolSchema,
  side: z.enum(["LONG", "SHORT"]),
  leverage: leverageSchema,
  margin: priceSchema.max(10_000_000),
  currentPrice: priceSchema
});

export const futuresCloseSchema = z.object({
  guestId: z.string().trim().optional(),
  symbol: symbolSchema,
  currentPrice: priceSchema
});

export const futuresLiquidationSchema = z.object({
  guestId: z.string().trim().optional(),
  symbol: symbolSchema,
  currentPrice: priceSchema
});

export const transferSchema = z.object({
  guestId: z.string().trim().optional(),
  direction: z.enum(["SPOT_TO_FUTURES", "FUTURES_TO_SPOT"]),
  amount: z.union([z.string(), z.number()])
});

export const futuresAddMarginSchema = z.object({
  guestId: z.string().trim().optional(),
  symbol: symbolSchema,
  addAmount: priceSchema.max(10_000_000)
});
