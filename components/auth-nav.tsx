"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface MeResponse {
  user: {
    id: string;
    email: string;
  } | null;
}

export function AuthNav() {
  const router = useRouter();
  const [user, setUser] = useState<MeResponse["user"]>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as Partial<MeResponse>;
        setUser(data.user ?? null);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const onLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST"
      });
      setUser(null);
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  if (loading) {
    return <span className="text-xs text-muted-foreground">Checking session...</span>;
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/login"
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          Login
        </Link>
        <Link
          href="/signup"
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          Sign up
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="rounded px-2 py-1 text-xs text-muted-foreground">{user.email}</span>
      <button
        type="button"
        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-50"
        onClick={() => void onLogout()}
        disabled={loggingOut}
      >
        {loggingOut ? "Logging out..." : "Logout"}
      </button>
    </div>
  );
}
