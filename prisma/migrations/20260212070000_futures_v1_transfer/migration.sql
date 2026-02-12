-- CreateTable
CREATE TABLE "FuturesAccount" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "cashUSDT" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FuturesAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuturesPosition" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "leverage" INTEGER NOT NULL,
    "margin" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "liquidationPrice" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FuturesPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuturesTrade" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL,
    "realizedPnl" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FuturesTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FuturesAccount_guestId_key" ON "FuturesAccount"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "FuturesPosition_guestId_symbol_key" ON "FuturesPosition"("guestId", "symbol");

-- CreateIndex
CREATE INDEX "FuturesTrade_guestId_createdAt_idx" ON "FuturesTrade"("guestId", "createdAt");

-- AddForeignKey
ALTER TABLE "FuturesAccount" ADD CONSTRAINT "FuturesAccount_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuturesPosition" ADD CONSTRAINT "FuturesPosition_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuturesTrade" ADD CONSTRAINT "FuturesTrade_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
