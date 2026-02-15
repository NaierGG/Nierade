import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyFill, ORDER_STATUS, ORDER_TYPE, requireGuestAndAccounts } from "@/lib/trading";
import { resolveAccountContext } from "@/lib/account-context";
import { createOrderSchema } from "@/lib/schemas";
import { errorResponse, ApiError, okResponse } from "@/lib/api-response";
import { assertAllowedSymbol, getServerPrice, verifyDrift } from "@/lib/pricing";

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    await prisma.$transaction(async (tx) => {
      await requireGuestAndAccounts(tx, ctx.guestId);
    });

    const [openOrders, recentOrders] = await Promise.all([
      prisma.order.findMany({
        where: {
          guestId: ctx.guestId,
          status: ORDER_STATUS.OPEN
        },
        orderBy: { createdAt: "desc" }
      }),
      prisma.order.findMany({
        where: {
          guestId: ctx.guestId,
          status: { not: ORDER_STATUS.OPEN }
        },
        orderBy: { createdAt: "desc" },
        take: 25
      })
    ]);

    return okResponse({ openOrders, recentOrders });
  } catch (error) {
    return errorResponse(error, "Failed to fetch orders.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createOrderSchema.parse(await request.json());
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    const guestId = ctx.guestId;

    const symbol = await assertAllowedSymbol(body.symbol);
    const side = body.side;
    const type = body.type;
    const qty = body.qty;

    if (type === ORDER_TYPE.MARKET) {
      if (typeof body.currentPrice !== "number") {
        throw new ApiError("VALIDATION_ERROR", "currentPrice is required for MARKET order.", 400);
      }
      const serverPrice = await getServerPrice(symbol);
      verifyDrift(body.currentPrice, serverPrice, 0.5);
      const executionPrice = serverPrice;

      const payload = await prisma.$transaction(async (tx) => {
        await requireGuestAndAccounts(tx, guestId);

        const now = new Date();
        const order = await tx.order.create({
          data: {
            guestId,
            symbol,
            side,
            type,
            qty,
            status: ORDER_STATUS.FILLED,
            filledAt: now
          }
        });

        const trade = await applyFill(tx, {
          guestId,
          symbol,
          side,
          qty,
          price: executionPrice,
          orderId: order.id
        });
        return { orderId: order.id, trade, executionPrice, serverPrice };
      });

      const [account, holdings, order] = await Promise.all([
        prisma.account.findUnique({ where: { guestId } }),
        prisma.holding.findMany({ where: { guestId }, orderBy: { symbol: "asc" } }),
        prisma.order.findUnique({ where: { id: payload.orderId } })
      ]);

      return okResponse({
        result: "FILLED",
        order,
        trade: payload.trade,
        account,
        holdings,
        price: {
          executionPrice: payload.executionPrice,
          serverPrice: payload.serverPrice
        }
      });
    }

    if (typeof body.limitPrice !== "number") {
      throw new ApiError("VALIDATION_ERROR", "limitPrice is required for LIMIT order.", 400);
    }

    const order = await prisma.$transaction(async (tx) => {
      await requireGuestAndAccounts(tx, guestId);
      return tx.order.create({
        data: {
          guestId,
          symbol,
          side,
          type,
          qty,
          limitPrice: Number(body.limitPrice),
          status: ORDER_STATUS.OPEN
        }
      });
    });

    const [account, holdings] = await Promise.all([
      prisma.account.findUnique({ where: { guestId } }),
      prisma.holding.findMany({ where: { guestId }, orderBy: { symbol: "asc" } })
    ]);

    return okResponse({
      result: "OPEN",
      order,
      trade: null,
      account,
      holdings
    });
  } catch (error) {
    return errorResponse(error, "Failed to create order.", "ORDER_CREATE_FAILED");
  }
}
