import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORDER_STATUS } from "@/lib/trading";
import { ApiError, errorResponse, okResponse } from "@/lib/api-response";
import { getServerPrice } from "@/lib/pricing";
import { fillLimitOrderWithPrice } from "@/lib/order-fill";

const BATCH_SIZE = 200;

export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET ?? "";
    const provided = request.headers.get("x-cron-secret") ?? "";
    if (!secret || provided !== secret) {
      throw new ApiError("UNAUTHORIZED", "Invalid cron secret.", 401);
    }

    let cursor: string | undefined;
    let scanned = 0;
    let filled = 0;
    let batches = 0;

    while (true) {
      const orders = await prisma.order.findMany({
        where: { status: ORDER_STATUS.OPEN, type: "LIMIT" },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      });
      if (orders.length === 0) {
        break;
      }
      batches += 1;
      scanned += orders.length;
      cursor = orders[orders.length - 1]?.id;

      const symbols = [...new Set(orders.map((order) => order.symbol))];
      const symbolPriceMap = new Map<string, number>();
      await Promise.all(
        symbols.map(async (symbol) => {
          const price = await getServerPrice(symbol);
          symbolPriceMap.set(symbol, price);
        })
      );

      for (const order of orders) {
        const executionPrice = symbolPriceMap.get(order.symbol);
        if (!executionPrice) {
          continue;
        }

        const result = await prisma.$transaction(async (tx) => {
          return fillLimitOrderWithPrice({
            tx,
            guestId: order.guestId,
            orderId: order.id,
            executionPrice
          });
        });
        if (result.filled) {
          filled += 1;
        }
      }
    }

    return okResponse({ scanned, filled, batches });
  } catch (error) {
    return errorResponse(error, "Failed to run limit-fill cron.", "CRON_LIMIT_FILL_FAILED");
  }
}
