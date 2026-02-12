# Crypto Paper Trader (Milestone 4)

Next.js App Router app for crypto paper trading with:
- Guest mode (`guestId` in `localStorage`)
- Email/password auth (no magic link)
- Prisma-backed DB sessions (persistent login)
- Spot + futures paper trading

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- shadcn/ui-style components
- Next.js API routes
- Prisma + PostgreSQL (Neon-ready)
- Prisma sessions + email/password auth

## Implemented

- Auth APIs:
  - `POST /api/auth/signup`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
  - `POST /api/link-guest`
- Auth UI:
  - `/login`
  - `/signup`
  - Top nav shows `Login/Sign up` when logged out
  - Top nav shows `email + Logout` when logged in
- Session model:
  - Session cookie name: `session_token`
  - Session storage: Prisma `Session` table
  - Session expiration: 30 days
- Guest linking:
  - After login/signup, current `guestId` is linked to the authenticated user
  - Also auto-links on app load when logged in and `guestId` exists
- Login/signup abuse protection:
  - Simple in-memory per-IP rate limiting (dev-focused)

## Deployment (Neon + Vercel)

1. Create a Neon project and copy the pooled connection string.
2. Set `DATABASE_URL` in Vercel Project Settings -> Environment Variables.
3. Set auth/env vars in Vercel as needed:
   - `AUTH_COOKIE_SECURE=true`
   - `DATABASE_URL=postgresql://...`
4. Build command on Vercel:

```bash
npm run vercel-build
```

`vercel-build` runs Prisma migrations first (`prisma migrate deploy`) and then builds Next.js.

## Local Run (Postgres)

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env.local
```

3. Set a Postgres URL in `.env.local`:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
```

4. Configure cookie security behavior (optional):

```bash
# default: true in production, false in dev
AUTH_COOKIE_SECURE=false
```

5. Run Prisma migration (development):

```bash
npx prisma migrate dev
```

6. Generate Prisma client (if needed):

```bash
npx prisma generate
```

7. Start dev server:

```bash
npm run dev
```

8. Open:

```text
http://localhost:3000/trade
```

## Build Check

```bash
npm run build
```

## Prisma Migration Workflow

- Development:

```bash
npx prisma migrate dev
```

- Production / Vercel:

```bash
npx prisma migrate deploy
```
# Nierade
Crypto paper trading platform with spot &amp; futures (100x leverage), built with Next.js, Prisma, and PostgreSQL.
