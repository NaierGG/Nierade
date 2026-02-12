"use client";

import { useEffect } from "react";

interface MeResponse {
  user: {
    id: string;
    email: string;
  } | null;
}

export function GuestLinker() {
  useEffect(() => {
    const linkGuestIfNeeded = async () => {
      const guestId = localStorage.getItem("guestId");
      if (!guestId) return;

      const meResponse = await fetch("/api/auth/me", { cache: "no-store" });
      const meData = (await meResponse.json().catch(() => ({}))) as Partial<MeResponse>;
      if (!meData.user) return;

      await fetch("/api/link-guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId })
      });
    };

    void linkGuestIfNeeded();
  }, []);

  return null;
}
