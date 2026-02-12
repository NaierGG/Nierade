import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  applyFill,
  assertPositiveNumber,
  assertSufficientBalanceOrHolding,
  canLimitOrderFill,
  TradingError,
  ORDER_SIDE,
  ORDER_STATUS,
  ORDER_TYPE
} from "@/lib/trading";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      guestId?: unknown;
      orderId?: unknown;
      currentPrice?: unknown;
    };

    const guestId =
      typeof body.guestId === "string" ? body.guestId.trim() : "";
    const orderId =
      typeof body.orderId === "string" ? body.orderId.trim() : "";
    const currentPrice = Number(body.currentPrice);

    if (!guestId) {
      throw new TradingError("guestId is required.");
    }
    if (!orderId) {
      throw new TradingError("orderId is required.");
    }
    assertPositiveNumber(currentPrice, "currentPrice");

    const now = new Date();

    const payload = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId }
      });

      if (!order || order.guestId !== guestId) {
        throw new TradingError("Order not found.", 404);
      }

      if (order.status !== ORDER_STATUS.OPEN || order.filledAt !== null) {
        return { filled: false as const, trade: null };
      }

      if (order.type !== ORDER_TYPE.LIMIT) {
        throw new TradingError("Only LIMIT orders can be filled via this endpoint.");
      }

      if (typeof order.limitPrice !== "number") {
        throw new TradingError("LIMIT order is missing limitPrice.");
      }

      if (order.side !== ORDER_SIDE.BUY && order.side !== ORDER_SIDE.SELL) {
        throw new TradingError("Order side is invalid.");
      }

      if (!canLimitOrderFill(order.side, order.limitPrice, currentPrice)) {
        return { filled: false as const, trade: null };
      }

      const lock = await tx.order.updateMany({
        where: {
          id: orderId,
          guestId,
          status: ORDER_STATUS.OPEN,
          filledAt: null
        },
        data: {
          status: ORDER_STATUS.FILLED,
          filledAt: now
        }
      });

      if (lock.count !== 1) {
        return { filled: false as const, trade: null };
      }

      try {
        await assertSufficientBalanceOrHolding(
          tx,
          guestId,
          order.symbol,
          order.side,
          order.qty,
          currentPrice
        );

        const trade = await applyFill(tx, {
          guestId,
          symbol: order.symbol,
          side: order.side,
          qty: order.qty,
          price: currentPrice,
          orderId: order.id
        });

        return { filled: true as const, trade };
      } catch (error) {
        await tx.order.updateMany({
          where: {
            id: orderId,
            guestId,
            status: ORDER_STATUS.FILLED,
            filledAt: now
          },
          data: {
            status: ORDER_STATUS.OPEN,
            filledAt: null
          }
        });

        if (error instanceof TradingError) {
          throw error;
        }
        throw new TradingError("Failed to fill order.");
      }
    });

    if (!payload.filled) {
      return NextResponse.json({ ok: true, filled: false });
    }

    return NextResponse.json({
      ok: true,
      filled: true,
      trade: payload.trade
    });
  } catch (error) {
    const message =
      error instanceof TradingError ? error.message : "Failed to fill order.";
    const statusCode = error instanceof TradingError ? error.statusCode : 500;
    return NextResponse.json(
      { ok: false, filled: false, error: message },
      { status: statusCode }
    );
  }
}
