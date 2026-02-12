"use client";

import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CoinLogo } from "@/components/coin-logo";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCompactNumber, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "quoteVolume" | "priceChangePercent";
type SortOrder = "asc" | "desc";
type TabValue = "all" | "watchlist";

interface TickerItem {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
}

const CACHE_MS = 30_000;
const CACHE_KEY = "markets_tickers_cache";
const WATCHLIST_KEY = "watchlist_symbols";
const LEVERAGED_RE = /(UP|DOWN|BEAR|BULL)USDT$/;
const STABLE_NOISE = new Set([
  "USDCUSDT",
  "FDUSDUSDT",
  "TUSDUSDT",
  "USDPUSDT",
  "DAIUSDT",
  "BUSDUSDT",
  "USD1USDT",
  "USDEUSDT",
  "USDSUSDT"
]);

function formatPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function parsePair(symbol: string) {
  if (symbol.endsWith("USDT")) {
    return {
      base: symbol.slice(0, -4),
      quote: "USDT"
    };
  }
  return {
    base: symbol,
    quote: ""
  };
}

function isTickerItemArray(value: unknown): value is TickerItem[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { symbol?: unknown }).symbol === "string" &&
      typeof (item as { lastPrice?: unknown }).lastPrice === "number" &&
      typeof (item as { priceChangePercent?: unknown }).priceChangePercent === "number" &&
      typeof (item as { quoteVolume?: unknown }).quoteVolume === "number"
  );
}

function filterTicker(item: TickerItem) {
  if (!item.symbol.endsWith("USDT")) return false;
  if (LEVERAGED_RE.test(item.symbol)) return false;
  if (STABLE_NOISE.has(item.symbol)) return false;
  return true;
}

function SnapshotCard({
  label,
  item,
  onClick
}: {
  label: string;
  item: TickerItem | null;
  onClick: (symbol: string) => void;
}) {
  return (
    <Card
      className={cn(
        "border-border/70 bg-card/70 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
        item ? "cursor-pointer" : ""
      )}
      onClick={() => (item ? onClick(item.symbol) : null)}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="flex items-center gap-2">
          <CoinLogo symbol={item?.symbol ?? "UNKNOWN"} size={28} />
          <p className="font-mono text-2xl font-semibold">{item?.symbol ?? "--"}</p>
        </div>
        <div>
          <Badge variant={item && item.priceChangePercent >= 0 ? "success" : "danger"}>
            {item ? formatPct(item.priceChangePercent) : "--"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{item ? formatPrice(item.lastPrice) : "No data"}</p>
      </CardContent>
    </Card>
  );
}

function MarketRowsSkeleton() {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="grid grid-cols-[28px_1.4fr_1fr_1fr_90px] gap-2">
          <Skeleton className="h-8 w-6" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

export default function MarketsPage() {
  const router = useRouter();
  const [tickers, setTickers] = useState<TickerItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabValue>("all");
  const [sortKey, setSortKey] = useState<SortKey>("quoteVolume");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());

  const fetchTickers = useCallback(
    async (background = false) => {
      if (background) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await fetch("/api/markets", { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          data?: TickerItem[];
          error?: string;
        };
        if (!response.ok || data.ok !== true || !isTickerItemArray(data.data)) {
          throw new Error(data.error ?? "Failed to load market data");
        }

        const filtered = data.data.filter(filterTicker);
        setTickers(filtered);
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), tickers: filtered }));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load market data");
      } finally {
        if (background) {
          setIsRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts?: number; tickers?: unknown };
        if (
          typeof parsed.ts === "number" &&
          Date.now() - parsed.ts < CACHE_MS &&
          isTickerItemArray(parsed.tickers)
        ) {
          setTickers(parsed.tickers.filter(filterTicker));
          setLoading(false);
        }
      }

      const rawWatchlist = localStorage.getItem(WATCHLIST_KEY);
      if (rawWatchlist) {
        const parsed = JSON.parse(rawWatchlist) as unknown;
        if (Array.isArray(parsed)) {
          setWatchlist(
            new Set(parsed.filter((item): item is string => typeof item === "string").map((item) => item.toUpperCase()))
          );
        }
      }
    } catch {
      // Ignore malformed localStorage.
    }

    void fetchTickers(false);
    const timer = setInterval(() => {
      void fetchTickers(true);
    }, CACHE_MS);
    return () => clearInterval(timer);
  }, [fetchTickers]);

  const toggleWatch = (symbol: string) => {
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const onSortClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
      return;
    }
    setSortKey(key);
    setSortOrder("desc");
  };

  const searched = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return tickers;
    return tickers.filter((item) => item.symbol.includes(q) || item.symbol.replace("USDT", "").includes(q));
  }, [search, tickers]);

  const sorted = useMemo(() => {
    return [...searched].sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      if (left === right) return a.symbol.localeCompare(b.symbol);
      return sortOrder === "desc" ? right - left : left - right;
    });
  }, [searched, sortKey, sortOrder]);

  const watchlistRows = useMemo(() => sorted.filter((item) => watchlist.has(item.symbol)), [sorted, watchlist]);
  const topGainer = useMemo(
    () => (tickers.length > 0 ? [...tickers].sort((a, b) => b.priceChangePercent - a.priceChangePercent)[0] : null),
    [tickers]
  );
  const topLoser = useMemo(
    () => (tickers.length > 0 ? [...tickers].sort((a, b) => a.priceChangePercent - b.priceChangePercent)[0] : null),
    [tickers]
  );
  const topVolume = useMemo(
    () => (tickers.length > 0 ? [...tickers].sort((a, b) => b.quoteVolume - a.quoteVolume)[0] : null),
    [tickers]
  );

  const rowsForTab = tab === "watchlist" ? watchlistRows : sorted;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1160px] p-4 md:p-6">
      <section className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Markets</h1>
          <p className="text-sm text-muted-foreground">Binance USDT pairs</p>
        </div>
        <div className="w-full sm:w-[320px]">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search BTC, ETH, DOGE"
          />
        </div>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <SnapshotCard label="Top gainer" item={topGainer} onClick={(symbol) => router.push(`/trade?symbol=${symbol}`)} />
        <SnapshotCard label="Top loser" item={topLoser} onClick={(symbol) => router.push(`/trade?symbol=${symbol}`)} />
        <SnapshotCard label="Top volume" item={topVolume} onClick={(symbol) => router.push(`/trade?symbol=${symbol}`)} />
      </section>

      <Tabs value={tab} onValueChange={(next) => setTab(next as TabValue)}>
        <div className="mb-4 flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
          </TabsList>
          <p className="text-xs text-muted-foreground">{isRefreshing ? "Refreshing..." : "Auto refresh: 30s"}</p>
        </div>

        {tab === "all" && watchlistRows.length > 0 ? (
          <Card className="mb-4 border-border/70 bg-card/70">
            <CardHeader className="pb-2">
              <CardTitle>Watchlist</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {watchlistRows.slice(0, 12).map((item) => (
                  <button
                    key={`chip-${item.symbol}`}
                    type="button"
                    className="rounded-full border border-border/80 bg-background/70 px-3 py-1 text-xs font-mono transition hover:border-primary/40"
                    onClick={() => router.push(`/trade?symbol=${item.symbol}`)}
                  >
                    {item.symbol}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-border/70 bg-card/70">
          <CardContent className="p-0">
            {error ? (
              <div className="flex items-center justify-between gap-3 p-4 text-sm">
                <p className="text-red-300">{error}</p>
                <Button size="sm" variant="outline" onClick={() => void fetchTickers(false)}>
                  Retry
                </Button>
              </div>
            ) : null}

            {loading && tickers.length === 0 ? (
              <MarketRowsSkeleton />
            ) : (
              <>
                <TabsContent value="all" className="mt-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Asset</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="cursor-pointer text-right" onClick={() => onSortClick("priceChangePercent")}>
                          24h %
                        </TableHead>
                        <TableHead className="cursor-pointer text-right" onClick={() => onSortClick("quoteVolume")}>
                          Volume
                        </TableHead>
                        <TableHead className="text-right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rowsForTab.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground">
                            No matching symbols.
                          </TableCell>
                        </TableRow>
                      ) : (
                        rowsForTab.map((item) => {
                          const pair = parsePair(item.symbol);
                          return (
                          <TableRow
                            key={item.symbol}
                            className="group cursor-pointer"
                            onClick={() => router.push(`/trade?symbol=${item.symbol}`)}
                          >
                            <TableCell
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleWatch(item.symbol);
                              }}
                            >
                              <Star
                                className={cn(
                                  "h-4 w-4 transition",
                                  watchlist.has(item.symbol)
                                    ? "fill-amber-300 text-amber-300"
                                    : "text-muted-foreground group-hover:text-foreground"
                                )}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <CoinLogo symbol={item.symbol} size={26} />
                                <div>
                                  <p className="font-mono text-sm font-semibold">{pair.base}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {pair.quote ? `${pair.base} / ${pair.quote}` : item.symbol}
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">{formatPrice(item.lastPrice)}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant={item.priceChangePercent >= 0 ? "success" : "danger"}>
                                {formatPct(item.priceChangePercent)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">{formatCompactNumber(item.quoteVolume)}</TableCell>
                            <TableCell className="text-right">
                              <span className="text-xs text-muted-foreground opacity-0 transition group-hover:opacity-100">
                                Trade
                              </span>
                            </TableCell>
                          </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </TabsContent>

                <TabsContent value="watchlist" className="mt-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Asset</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">24h %</TableHead>
                        <TableHead className="text-right">Volume</TableHead>
                        <TableHead className="text-right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {watchlistRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground">
                            Your watchlist is empty.
                          </TableCell>
                        </TableRow>
                      ) : (
                        watchlistRows.map((item) => {
                          const pair = parsePair(item.symbol);
                          return (
                          <TableRow
                            key={`watch-${item.symbol}`}
                            className="group cursor-pointer"
                            onClick={() => router.push(`/trade?symbol=${item.symbol}`)}
                          >
                            <TableCell
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleWatch(item.symbol);
                              }}
                            >
                              <Star className="h-4 w-4 fill-amber-300 text-amber-300" />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <CoinLogo symbol={item.symbol} size={26} />
                                <div>
                                  <p className="font-mono text-sm font-semibold">{pair.base}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {pair.quote ? `${pair.base} / ${pair.quote}` : item.symbol}
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono">{formatPrice(item.lastPrice)}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant={item.priceChangePercent >= 0 ? "success" : "danger"}>
                                {formatPct(item.priceChangePercent)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono">{formatCompactNumber(item.quoteVolume)}</TableCell>
                            <TableCell className="text-right">
                              <span className="text-xs text-muted-foreground opacity-0 transition group-hover:opacity-100">
                                Trade
                              </span>
                            </TableCell>
                          </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </TabsContent>
              </>
            )}
          </CardContent>
        </Card>
      </Tabs>
    </main>
  );
}
