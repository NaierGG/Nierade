const assert = require("node:assert/strict");
const { simulateConcurrentBuys } = require("./helpers/simulate-concurrency.js");

const GUEST_ID_RE = /^guest_[0-9a-fA-F-]{36}$/;

function resolveGuestIdForRequest({ sessionGuestId, requestGuestId }) {
  if (sessionGuestId) return sessionGuestId;
  if (!GUEST_ID_RE.test(requestGuestId ?? "")) {
    throw new Error("INVALID_GUEST_ID");
  }
  return requestGuestId;
}

function verifyPriceDrift(clientPrice, serverPrice, maxDriftPct = 0.5) {
  const driftPct = Math.abs((clientPrice - serverPrice) / serverPrice) * 100;
  if (driftPct > maxDriftPct) {
    throw new Error("PRICE_DRIFT_EXCEEDED");
  }
  return driftPct;
}

async function run() {
  const resolved = resolveGuestIdForRequest({
    sessionGuestId: "guest_123e4567-e89b-12d3-a456-426614174000",
    requestGuestId: "guest_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
  });
  assert.equal(resolved, "guest_123e4567-e89b-12d3-a456-426614174000");

  const concurrency = await simulateConcurrentBuys({ startingCash: 100, spendAmount: 80 });
  const successful = [concurrency.a, concurrency.b].filter(Boolean).length;
  assert.equal(successful, 1);
  assert.equal(concurrency.finalCash, 20);

  assert.throws(() => verifyPriceDrift(110, 100, 0.5), /PRICE_DRIFT_EXCEEDED/);

  console.log("security checks passed");
}

run().catch((error) => {
  console.error("security checks failed", error);
  process.exit(1);
});
