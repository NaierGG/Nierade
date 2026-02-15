import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAccountContext } from "@/lib/account-context";
import { fillOrderSchema } from "@/lib/schemas";
import { ApiError, errorResponse, okResponse } from "@/lib/api-response";
import { getServerPrice, verifyDrift } from "@/lib/pricing";
import { fillLimitOrderWithPrice } from "@/lib/order-fill";

export async function POST(request: NextRequest) {
  try {
    const body = fillOrderSchema.parse(await request.json());
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    const guestId = ctx.guestId;

    const order = await prisma.order.findFirst({
      where: { id: body.orderId, guestId },
      select: { symbol: true }
    });
    if (!order) {
      throw new ApiError("ORDER_NOT_FOUND", "Order not found.", 404);
    }

    const serverPrice = await getServerPrice(order.symbol);
    if (typeof body.currentPrice === "number") {
      verifyDrift(body.currentPrice, serverPrice, 0.5);
    }
    const executionPrice = serverPrice;

    const payload = await prisma.$transaction(async (tx) => {
      const result = await fillLimitOrderWithPrice({
        tx,
        guestId,
        orderId: body.orderId,
        executionPrice
      });
      return result;
    });

    return okResponse({
      filled: payload.filled,
      trade: payload.trade,
      price: {
        executionPrice,
        serverPrice
      }
    });
  } catch (error) {
    return errorResponse(error, "Failed to fill order.", "ORDER_FILL_FAILED");
  }
}
