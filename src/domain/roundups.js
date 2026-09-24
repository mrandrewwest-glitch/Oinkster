/**
 * Calculate round-ups for a list of bank transactions.
 * Only debits (purchases, negative amounts) are rounded up; credits are ignored.
 *
 * @param {Array<{id: string, amountCents: number}>} transactions
 * @param {number} multipleCents round up to the next multiple of this (100 = next dollar)
 * @returns {{items: Array<{transactionId: string, roundupCents: number}>, totalCents: number}}
 */
export function calculateRoundups(transactions, multipleCents = 100) {
  if (!Number.isInteger(multipleCents) || multipleCents <= 0) {
    throw new RangeError('multipleCents must be a positive integer');
  }
  const items = [];
  for (const tx of transactions) {
    if (tx.amountCents >= 0) continue;
    const spend = -tx.amountCents;
    const remainder = spend % multipleCents;
    if (remainder === 0) continue;
    items.push({ transactionId: tx.id, roundupCents: multipleCents - remainder });
  }
  return { items, totalCents: items.reduce((sum, i) => sum + i.roundupCents, 0) };
}
