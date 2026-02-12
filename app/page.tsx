"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface TickerItem {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
}

const FALLBACK_TICKERS: TickerItem[] = [
  { symbol: "BTCUSDT", lastPrice: 64231.4, priceChangePercent: 2.4, quoteVolume: 1000000000 },
  { symbol: "ETHUSDT", lastPrice: 3452.12, priceChangePercent: 1.8, quoteVolume: 800000000 },
  { symbol: "SOLUSDT", lastPrice: 145.2, priceChangePercent: -0.5, quoteVolume: 500000000 }
];

export default function HomePage() {
  const [tickers, setTickers] = useState<TickerItem[]>(FALLBACK_TICKERS);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/binance/tickers", { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as { tickers?: TickerItem[] };
        if (!response.ok || !Array.isArray(data.tickers)) return;
        const top = [...data.tickers]
          .sort((a, b) => b.quoteVolume - a.quoteVolume)
          .slice(0, 8);
        if (top.length > 0) setTickers(top);
      } catch {
        // Keep fallback market tape if API is unavailable.
      }
    };

    void load();
  }, []);

  const tickerTape = useMemo(() => [...tickers, ...tickers], [tickers]);

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_20%_10%,rgba(74,222,128,0.14),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(6,182,212,0.18),transparent_35%),linear-gradient(180deg,#020617_0%,#040c1a_45%,#030712_100%)] pt-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/4 top-0 h-[380px] w-[380px] rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="absolute bottom-10 right-1/4 h-[430px] w-[430px] rounded-full bg-cyan-400/10 blur-3xl" />
      </div>

      <div className="fixed left-0 right-0 top-12 z-40 h-10 overflow-hidden border-y border-white/10 bg-slate-950/85 backdrop-blur">
        <div className="animate-ticker-scroll flex min-w-max items-center gap-8 whitespace-nowrap px-4">
          {tickerTape.map((item, index) => (
            <div key={`${item.symbol}-${index}`} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-cyan-300">{item.symbol.replace("USDT", "/USDT")}</span>
              <span className="font-mono text-slate-100">${item.lastPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
              <span className={item.priceChangePercent >= 0 ? "font-mono text-emerald-400" : "font-mono text-rose-400"}>
                {item.priceChangePercent >= 0 ? "+" : ""}
                {item.priceChangePercent.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      <section className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-4 pb-16 pt-24 text-center md:pt-28">
        <h1 className="animate-float-soft bg-gradient-to-r from-emerald-300 via-cyan-300 to-slate-200 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent md:text-7xl">
          Start Trading Risk-Free
        </h1>
        <p className="mt-5 max-w-3xl text-sm leading-relaxed text-slate-300 md:text-lg">
          Master the crypto markets with real-time simulation, advanced charting, and paper futures up to 100x,
          without risking real capital.
        </p>

        <div className="mt-10 w-full max-w-xl rounded-2xl border border-emerald-300/25 bg-slate-900/55 p-1 shadow-[0_0_50px_rgba(16,185,129,0.12)] backdrop-blur-xl">
          <div className="rounded-xl border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 p-7">
            <h2 className="text-xl font-semibold text-slate-100">Crypto Paper Terminal</h2>
            <p className="mt-2 text-xs text-slate-400">Paper trading only. Not financial advice.</p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Link
                href="/trade"
                className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-3 text-sm font-bold text-slate-950 transition hover:brightness-110"
              >
                Go to Trade
              </Link>
              <Link
                href="/markets"
                className="inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/5 px-5 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10"
              >
                Markets
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-12">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { title: "Spot Paper", desc: "Real-time spot simulation" },
            { title: "Futures up to 100x", desc: "High leverage training mode" },
            { title: "Spot  Futures", desc: "Fast internal transfer flow" }
          ].map((feature) => (
            <article
              key={feature.title}
              className="rounded-xl border border-white/10 bg-slate-900/45 p-5 shadow-lg transition duration-300 hover:-translate-y-1 hover:border-cyan-300/40 hover:shadow-[0_12px_36px_rgba(6,182,212,0.18)]"
            >
              <h3 className="text-base font-semibold text-slate-100">{feature.title}</h3>
              <p className="mt-1 text-sm text-slate-400">{feature.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="relative z-10 border-y border-white/10 bg-slate-950/35 py-14">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-4 md:grid-cols-3">
          {[
            {
              title: "Advanced Charting",
              text: "TradingView-grade chart workflow with fast symbol switching and compact layout."
            },
            {
              title: "Real-Time Data",
              text: "Live Binance stream integration for ticker moves, order behavior, and futures updates."
            },
            {
              title: "Risk Management",
              text: "Practice margin control, leverage sizing, and liquidation awareness before going live."
            }
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-white/10 bg-slate-900/45 p-6 text-center">
              <h4 className="text-lg font-semibold text-slate-100">{item.title}</h4>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative z-10 py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-4 text-xs text-slate-500">
          <p>© 2026 Crypto Paper Trader. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <Link href="/markets" className="transition hover:text-cyan-300">
              Markets
            </Link>
            <Link href="/trade" className="transition hover:text-cyan-300">
              Trade
            </Link>
            <Link href="/" className="transition hover:text-cyan-300">
              Home
            </Link>
          </div>
          <p className="text-[11px] text-slate-600">This platform is for simulation and educational use only.</p>
        </div>
      </footer>
    </main>
  );
}
