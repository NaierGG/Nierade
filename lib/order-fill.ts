import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api-response";
import { applyFill, canLimitOrderFill, ORDER_SIDE, ORDER_STATUS, ORDER_TYPE } from "@/lib/trading";

interface FillLimitOrderInput {
  tx: Prisma.TransactionClient;
  guestId: string;
  orderId: string;
  executionPrice: number;
}

export async function fillLimitOrderWithPrice(input: FillLimitOrderInput) {
  const { tx, guestId, orderId, executionPrice } = input;
  const now = new Date();

  const order = await tx.order.findUnique({
    where: { id: orderId }
  });

  if (!order || order.guestId !== guestId) {
    throw new ApiError("ORDER_NOT_FOUND", "Order not found.", 404);
  }
  if (order.status !== ORDER_STATUS.OPEN || order.filledAt !== null) {
    return { filled: false as const, trade: null };
  }
  if (order.type !== ORDER_TYPE.LIMIT) {
    throw new ApiError("INVALID_ORDER_TYPE", "Only LIMIT orders can be filled via this flow.", 400);
  }
  if (typeof order.limitPrice !== "number") {
    throw new ApiError("INVALID_ORDER", "LIMIT order is missing limitPrice.", 400);
  }
  if (order.side !== ORDER_SIDE.BUY && order.side !== ORDER_SIDE.SELL) {
    throw new ApiError("INVALID_ORDER", "Order side is invalid.", 400);
  }
  if (!canLimitOrderFill(order.side, order.limitPrice, executionPrice)) {
    return { filled: false as const, trade: null };
  }

  const lock = await tx.order.updateMany({
    where: { id: order.id, guestId, status: ORDER_STATUS.OPEN, filledAt: null },
    data: { status: ORDER_STATUS.FILLED, filledAt: now }
  });
  if (lock.count !== 1) {
    return { filled: false as const, trade: null };
  }

  try {
    const trade = await applyFill(tx, {
      guestId,
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      price: executionPrice,
      orderId: order.id
    });
    return { filled: true as const, trade };
  } catch (error) {
    await tx.order.updateMany({
      where: { id: order.id, guestId, status: ORDER_STATUS.FILLED, filledAt: now },
      data: { status: ORDER_STATUS.OPEN, filledAt: null }
    });
    throw error;
  }
}
