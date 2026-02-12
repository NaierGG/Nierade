"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  setValue: (next: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

export function Tabs({
  value,
  onValueChange,
  className,
  children
}: {
  value: string;
  onValueChange: (next: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TabsContext.Provider value={{ value, setValue: onValueChange }}>
      <div className={cn("w-full", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("inline-flex rounded-lg bg-accent/60 p-1", className)}>{children}</div>;
}

export function TabsTrigger({
  value,
  className,
  children
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const context = React.useContext(TabsContext);
  if (!context) return null;
  const selected = context.value === value;
  return (
    <button
      type="button"
      onClick={() => context.setValue(value)}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-medium transition",
        selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const context = React.useContext(TabsContext);
  if (!context || context.value !== value) return null;
  return <div className={cn("mt-4", className)}>{children}</div>;
}

