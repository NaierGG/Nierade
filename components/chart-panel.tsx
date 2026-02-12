"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

declare global {
  interface Window {
    TradingView?: {
      widget: new (options: Record<string, unknown>) => unknown;
    };
  }
}

interface ChartPanelProps {
  symbol: string;
}

export function ChartPanel({ symbol }: ChartPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => {
      if (!containerRef.current || !window.TradingView) return;
      // TradingView widget mounts directly into this container.
      new window.TradingView.widget({
        autosize: true,
        symbol: `BINANCE:${symbol}`,
        interval: "15",
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "en",
        enable_publishing: false,
        allow_symbol_change: false,
        hide_top_toolbar: false,
        hide_legend: false,
        save_image: false,
        container_id: "tradingview_container"
      });
    };

    containerRef.current.appendChild(script);
  }, [symbol]);

  return (
    <Card className="h-[420px] md:h-[520px] xl:h-[620px] border-border/80 bg-card/80 backdrop-blur-sm">
      <CardHeader className="border-b border-border/70 pb-3">
        <CardTitle className="text-sm">Chart</CardTitle>
      </CardHeader>
      <CardContent className="h-[calc(100%-56px)] p-0">
        <div id="tradingview_container" ref={containerRef} className="h-full w-full" />
      </CardContent>
    </Card>
  );
}
