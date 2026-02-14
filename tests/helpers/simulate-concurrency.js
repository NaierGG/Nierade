class FakeAtomicAccount {
  constructor(cashUSDT) {
    this.cashUSDT = cashUSDT;
  }

  async spendCashAtomic(amount) {
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 5)));
    if (this.cashUSDT < amount) {
      return false;
    }
    this.cashUSDT -= amount;
    return true;
  }
}

async function simulateConcurrentBuys({ startingCash, spendAmount }) {
  const account = new FakeAtomicAccount(startingCash);
  const [a, b] = await Promise.all([
    account.spendCashAtomic(spendAmount),
    account.spendCashAtomic(spendAmount)
  ]);
  return { a, b, finalCash: account.cashUSDT };
}

module.exports = {
  simulateConcurrentBuys
};
