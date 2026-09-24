import { grossUp } from './money.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const FREQUENCY_DAYS = {
  weekly: 7,
  fortnightly: 14,
  monthly: 365.25 / 12,
};

/**
 * Work out how much a user must put away each period to hit their target
 * by the deadline, and whether they are on track.
 * `requiredPerPeriodCents` is what the user needs to put in each period. It includes
 * the deposit fee (`feeBps`), so the goal still reaches its target after fees.
 */
export function buildPlan({ targetCents, balanceCents, startDate, deadline, now = new Date(), feeBps = 0 }) {
  const remainingCents = Math.max(targetCents - balanceCents, 0);
  const msLeft = new Date(deadline).getTime() - now.getTime();
  const daysLeft = Math.max(Math.ceil(msLeft / DAY_MS), 0);

  const perPeriod = {};
  for (const [freq, days] of Object.entries(FREQUENCY_DAYS)) {
    const periodsLeft = Math.max(Math.ceil(daysLeft / days), 1);
    perPeriod[freq] = grossUp(Math.ceil(remainingCents / periodsLeft), feeBps);
  }

  // Where should the balance be today if saving evenly from start to deadline?
  const totalMs = new Date(deadline).getTime() - new Date(startDate).getTime();
  const elapsedMs = Math.min(Math.max(now.getTime() - new Date(startDate).getTime(), 0), totalMs);
  const expectedCents = totalMs > 0 ? Math.round((targetCents * elapsedMs) / totalMs) : targetCents;

  return {
    targetCents,
    balanceCents,
    remainingCents,
    percentComplete: targetCents > 0 ? Math.min(Math.floor((balanceCents / targetCents) * 100), 100) : 100,
    daysLeft,
    expectedBalanceCents: expectedCents,
    onTrack: balanceCents >= expectedCents,
    requiredPerPeriodCents: perPeriod,
    milestones: [25, 50, 75, 100].map((pct) => ({
      percent: pct,
      amountCents: Math.round((targetCents * pct) / 100),
      reached: balanceCents * 100 >= targetCents * pct,
    })),
  };
}

export function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
