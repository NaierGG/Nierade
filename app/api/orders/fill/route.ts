import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  applyFill,
  canLimitOrderFill,
  TradingError,
  ORDER_SIDE,
  ORDER_STATUS,
  ORDER_TYPE
} from "@/lib/trading";
import { resolveAccountContext } from "@/lib/account-context";
import { fillOrderSchema } from "@/lib/schemas";
import { errorResponse } from "@/lib/api-response";
import { resolveExecutionPrice } from "@/lib/pricing";

export async function POST(request: NextRequest) {
  try {
    const body = fillOrderSchema.parse(await request.json());
    const ctx = await resolveAccountContext(request, {
      allowGuest: true,
      guestId: body.guestId
    });
    const guestId = ctx.guestId;
    const orderId = body.orderId;

    const now = new Date();

    const payload = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId }
      });

      if (!order || order.guestId !== guestId) {
        throw new TradingError("Order not found.", 404);
      }

      if (order.status !== ORDER_STATUS.OPEN || order.filledAt !== null) {
        return { filled: false as const, trade: null, price: null };
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

      const { executionPrice, serverPrice } = await resolveExecutionPrice(order.symbol, body.currentPrice);
      if (!canLimitOrderFill(order.side, order.limitPrice, executionPrice)) {
        return { filled: false as const, trade: null, price: { executionPrice, serverPrice } };
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
        return { filled: false as const, trade: null, price: { executionPrice, serverPrice } };
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

        return { filled: true as const, trade, price: { executionPrice, serverPrice } };
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
        throw error;
      }
    });

    if (!payload.filled) {
      return NextResponse.json({ ok: true, data: { filled: false, price: payload.price }, filled: false });
    }

    return NextResponse.json({
      ok: true,
      data: { filled: true, trade: payload.trade, price: payload.price },
      filled: true,
      trade: payload.trade
    });
  } catch (error) {
    if (error instanceof TradingError) {
      return NextResponse.json(
        {
          ok: false,
          filled: false,
          error: { code: "ORDER_FILL_FAILED", message: error.message }
        },
        { status: error.statusCode }
      );
    }
    return errorResponse(error, "Failed to fill order.", "ORDER_FILL_FAILED");
  }
}
