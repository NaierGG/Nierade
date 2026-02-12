import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORDER_STATUS } from "@/lib/trading";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    guestId?: unknown;
    orderId?: unknown;
  };

  const guestId =
    typeof body.guestId === "string" ? body.guestId.trim() : "";
  const orderId =
    typeof body.orderId === "string" ? body.orderId.trim() : "";

  if (!guestId) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
  }
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  }

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
    return NextResponse.json(
      { error: "Order not found or not open." },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  return NextResponse.json({ order });
}
