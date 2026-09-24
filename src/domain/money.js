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

// Oinkster never charges fees. Every movement of money passes through this
// so the promise is enforced in code, not just in marketing.
export const FEE_CENTS = 0;
