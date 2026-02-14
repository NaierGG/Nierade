"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

function getErrorMessage(value: unknown) {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof (value as { message?: unknown }).message === "string"
  ) {
    return (value as { message: string }).message;
  }
  return null;
}

async function linkGuestAfterAuth() {
  const guestId = localStorage.getItem("guestId");
  if (!guestId) return;

  await fetch("/api/link-guest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guestId })
  });
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: unknown };
      if (!response.ok) {
        setError(getErrorMessage(data.error) ?? "Login failed.");
        return;
      }

      await linkGuestAfterAuth();
      router.push("/trade");
      router.refresh();
    } catch {
      setError("Login failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-md items-center px-4 py-8">
      <div className="w-full rounded-lg border border-border/70 bg-card/80 p-6">
        <h1 className="text-xl font-semibold">Login</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use your email and password.</p>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div className="space-y-1">
            <label htmlFor="login-email" className="text-sm">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="login-password" className="text-sm">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button
            type="submit"
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            disabled={submitting}
          >
            {submitting ? "Logging in..." : "Login"}
          </button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">
          No account?{" "}
          <Link href="/signup" className="text-foreground underline">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
