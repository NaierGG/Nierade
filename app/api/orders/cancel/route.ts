import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORDER_STATUS } from "@/lib/trading";
import { resolveAccountContext } from "@/lib/account-context";
import { cancelOrderSchema } from "@/lib/schemas";
import { ApiError, errorResponse, okResponse } from "@/lib/api-response";

export async function POST(request: NextRequest) {
  try {
    const body = cancelOrderSchema.parse(await request.json());
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    const guestId = ctx.guestId;
    const orderId = body.orderId;

    const updated = await prisma.order.updateMany({
      where: {
        id: orderId,
        guestId,
        status: ORDER_STATUS.OPEN
      },
      data: {
        status: ORDER_STATUS.CANCELED
      }
    });

    if (updated.count === 0) {
      throw new ApiError("ORDER_NOT_OPEN", "Order not found or not open.", 400);
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    return okResponse({ order });
  } catch (error) {
    return errorResponse(error, "Failed to cancel order.", "ORDER_CANCEL_FAILED");
  }
}
