import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRoundups } from '../src/domain/roundups.js';
import { buildPlan, addMonths } from '../src/domain/savingsPlan.js';

test('round-ups only apply to purchases and skip whole-dollar amounts', () => {
  const { items, totalCents } = calculateRoundups([
    { id: 'a', amountCents: -450 }, // $4.50 -> 50c
    { id: 'b', amountCents: -1000 }, // $10.00 -> nothing
    { id: 'c', amountCents: 2500 }, // credit -> ignored
    { id: 'd', amountCents: -1299 }, // $12.99 -> 1c
  ]);
  assert.deepEqual(items, [
    { transactionId: 'a', roundupCents: 50 },
    { transactionId: 'd', roundupCents: 1 },
  ]);
  assert.equal(totalCents, 51);
});

test('round-ups to the nearest $5', () => {
  assert.equal(calculateRoundups([{ id: 'a', amountCents: -1200 }], 500).totalCents, 300);
});

test('plan: $5000 over 6 months', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const plan = buildPlan({ targetCents: 500000, balanceCents: 0, startDate: start, deadline: addMonths(start, 6), now: start });
  assert.equal(plan.remainingCents, 500000);
  assert.equal(plan.requiredPerPeriodCents.monthly, Math.ceil(500000 / 6));
  assert.equal(plan.requiredPerPeriodCents.fortnightly, Math.ceil(500000 / 13));
  assert.equal(plan.percentComplete, 0);
  assert.equal(plan.onTrack, true);
});

test('plan: behind schedule halfway through', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const deadline = new Date('2026-01-31T00:00:00Z');
  const plan = buildPlan({ targetCents: 30000, balanceCents: 5000, startDate: start, deadline, now: new Date('2026-01-16T00:00:00Z') });
  assert.equal(plan.expectedBalanceCents, 15000);
  assert.equal(plan.onTrack, false);
  assert.equal(plan.milestones[0].reached, false);
});

test('addMonths clamps to month end', () => {
  assert.equal(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString(), '2026-02-28T00:00:00.000Z');
});
