// All money is handled as integer cents (AUD) to avoid floating point errors.

export function toCents(dollars) {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars)) {
    throw new TypeError('amount must be a finite number');
  }
  return Math.round(dollars * 100);
}

export function toDollars(cents) {
  return cents / 100;
}

export function formatAud(cents) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

// Oinkster charges a flat fee on every dollar that comes in (deposits, payroll,
// transfers, round-ups). Payouts are free. Rates are in basis points: 150 = 1.5%.
export const DEFAULT_DEPOSIT_FEE_BPS = 150;

export function depositFee(grossCents, feeBps) {
  return Math.round((grossCents * feeBps) / 10000);
}

/** How much must come in (before fees) for `netCents` to land in the goal. */
export function grossUp(netCents, feeBps) {
  if (netCents <= 0) return 0;
  // Net is non-decreasing in gross, so step up from a safe lower bound to the smallest fit.
  let gross = Math.max(netCents, Math.floor(((netCents - 1) * 10000) / (10000 - feeBps)));
  while (gross - depositFee(gross, feeBps) < netCents) gross += 1;
  return gross;
}
