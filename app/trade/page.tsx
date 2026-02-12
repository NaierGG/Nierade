import { Suspense } from "react";
import { TradeTerminal } from "@/components/trade-terminal";

export default function TradePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto min-h-screen max-w-[1400px] p-4 md:p-6">
          <div className="rounded-lg border border-border/80 bg-card/80 p-4 text-sm text-muted-foreground">
            Loading terminal...
          </div>
        </main>
      }
    >
      <TradeTerminal />
    </Suspense>
  );
}
