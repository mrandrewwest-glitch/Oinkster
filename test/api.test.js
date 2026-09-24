import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, payoutAccount } from './helpers.js';

async function createUserAndGoal(ctx, goalOverrides = {}) {
  const user = (await request(ctx.app).post('/users').send({ email: 'sam@example.com', firstName: 'Sam', lastName: 'Lee' }).expect(201)).body;
  const goal = (await request(ctx.app).post(`/users/${user.id}/goals`).send({
    name: 'Pay off credit card',
    category: 'credit_card',
    targetAmount: 5000,
    timelineMonths: 6,
    payoutAccount,
    notifications: { reminders: 'fortnightly', statements: 'monthly', channel: 'email' },
    ...goalOverrides,
  }).expect(201)).body;
  return { user, goal };
}

test('creates a $5000 / 6 month goal with a savings plan', async () => {
  const ctx = setup();
  const { goal } = await createUserAndGoal(ctx);
  assert.equal(goal.targetCents, 500000);
  assert.equal(goal.deadline, '2026-07-01T00:00:00.000Z');
  assert.equal(goal.payoutAccount.bsb, '062-000');
  assert.equal(goal.lock.locked, true);
  assert.ok(goal.plan.requiredPerPeriodCents.fortnightly > 0);
});

test('validates goal input', async () => {
  const ctx = setup();
  const { user } = await createUserAndGoal(ctx);
  const res = await request(ctx.app).post(`/users/${user.id}/goals`).send({ name: 'x', targetAmount: 100, timelineMonths: 3, payoutAccount: { ...payoutAccount, bsb: '12' } }).expect(400);
  assert.match(res.body.error, /bsb/);
  await request(ctx.app).post(`/users/${user.id}/goals`).send({ name: 'x', targetAmount: -5, timelineMonths: 3, payoutAccount }).expect(400);
  await request(ctx.app).post(`/users/${user.id}/goals`).send({ name: 'x', targetAmount: 5, payoutAccount }).expect(400);
});

test('deposits from linked account take a 1.5% fee', async () => {
  const ctx = setup();
  const { goal } = await createUserAndGoal(ctx);
  const res = await request(ctx.app).post(`/goals/${goal.id}/deposits`).send({ amount: 250.5 }).expect(201);
  // 1.5% of $250.50 = $3.7575 -> $3.76
  assert.equal(res.body.entry.grossCents, 25050);
  assert.equal(res.body.entry.feeCents, 376);
  assert.equal(res.body.entry.amountCents, 24674);
  assert.equal(res.body.goal.balanceCents, 24674);
  assert.equal(ctx.provider.debits[0].amountCents, 25050);
});

test('the savings plan grosses up for the fee', async () => {
  const ctx = setup();
  const { goal } = await createUserAndGoal(ctx);
  const monthly = goal.plan.requiredPerPeriodCents.monthly;
  const fee = Math.round((monthly * 150) / 10000);
  assert.ok(monthly - fee >= Math.ceil(500000 / 6));
});

test('money is locked until target or deadline (forced savings)', async () => {
  const ctx = setup();
  const { goal } = await createUserAndGoal(ctx);
  await request(ctx.app).post(`/goals/${goal.id}/deposits`).send({ amount: 100 }).expect(201);
  const res = await request(ctx.app).post(`/goals/${goal.id}/payout`).expect(423);
  assert.equal(res.body.details.reason, 'locked_until_target_or_deadline');

  ctx.clock.now = new Date('2026-07-02T00:00:00Z');
  const paid = await request(ctx.app).post(`/goals/${goal.id}/payout`).expect(200);
  assert.equal(paid.body.goal.status, 'paid_out');
  assert.equal(paid.body.entry.feeCents, 0);
  assert.equal(ctx.provider.payouts[0].amountCents, 9850);
});

test('early release needs a 7 day cooling-off period', async () => {
  const ctx = setup();
  const { goal } = await createUserAndGoal(ctx);
  await request(ctx.app).post(`/goals/${goal.id}/deposits`).send({ amount: 100 }).expect(201);
  const req = await request(ctx.app).post(`/goals/${goal.id}/early-release`).send({ reason: 'Car repairs' }).expect(202);
  assert.equal(req.body.lock.reason, 'early_release_cooling_off');
  await request(ctx.app).post(`/goals/${goal.id}/payout`).expect(423);
  ctx.clock.now = new Date('2026-01-08T00:00:00Z');
  await request(ctx.app).post(`/goals/${goal.id}/payout`).expect(200);
});

test('reaching the target automatically pays into the nominated account', async () => {
  const ctx = setup();
  const { goal } = await createUserAndGoal(ctx);
  await request(ctx.app).post(`/goals/${goal.id}/deposits`).send({ amount: 4000 }).expect(201); // $3,940 after fee
  const partial = await request(ctx.app).post(`/goals/${goal.id}/deposits`).send({ amount: 1000 }).expect(201); // $985
  assert.equal(partial.body.goal.status, 'active');
  assert.equal(partial.body.goal.balanceCents, 492500);
  const res = await request(ctx.app).post(`/goals/${goal.id}/deposits`).send({ amount: 100 }).expect(201); // $98.50
  assert.equal(res.body.goal.status, 'paid_out');
  assert.equal(ctx.provider.payouts[0].amountCents, 502350);
  assert.equal(ctx.provider.payouts[0].reference, 'LOAN123');
  await request(ctx.app).post(`/goals/${goal.id}/deposits`).send({ amount: 1 }).expect(409);
});

test('employer payroll deposits are split across goals by allocation', async () => {
  const ctx = setup({ webhookSecret: 's3cret' });
  const { user, goal } = await createUserAndGoal(ctx, { payrollAllocationPercent: 60 });
  const holiday = (await request(ctx.app).post(`/users/${user.id}/goals`).send({
    name: 'Japan', category: 'holiday', targetAmount: 4000, timelineMonths: 10, payoutAccount, payrollAllocationPercent: 40,
  }).expect(201)).body;
  await request(ctx.app).post(`/users/${user.id}/goals`).send({
    name: 'Too much', targetAmount: 10, timelineMonths: 1, payoutAccount, payrollAllocationPercent: 1,
  }).expect(400);

  const instructions = (await request(ctx.app).get(`/users/${user.id}/payroll-instructions`).expect(200)).body;
  assert.equal(instructions.bsb, '123-456');
  assert.equal(instructions.reference, user.payrollReference);

  await request(ctx.app).post('/webhooks/incoming-payment').send({ reference: user.payrollReference, amount: 300 }).expect(401);
  await request(ctx.app)
    .post('/webhooks/incoming-payment')
    .set('x-webhook-secret', 's3cret')
    .send({ reference: user.payrollReference, amount: 300.01, payerName: 'Acme Pty Ltd' })
    .expect(201);

  const g1 = (await request(ctx.app).get(`/goals/${goal.id}`)).body;
  const g2 = (await request(ctx.app).get(`/goals/${holiday.id}`)).body;
  // $120.00 to Japan (40%) and $180.01 to the card (60% + rounding), each less 1.5%
  assert.equal(g2.balanceCents, 12000 - 180);
  assert.equal(g1.balanceCents, 18001 - 270);
});

test('round-up sweep saves spare change from new purchases only', async () => {
  const ctx = setup();
  const { user, goal } = await createUserAndGoal(ctx, { roundups: { enabled: true } });
  ctx.provider.seedTransactions(user.providerUserId, [
    { amountCents: -450, postDate: '2025-12-30T00:00:00Z' }, // before goal started
    { amountCents: -375, postDate: '2026-01-02T00:00:00Z' },
    { amountCents: -1210, postDate: '2026-01-03T00:00:00Z' },
  ]);
  ctx.clock.now = new Date('2026-01-04T00:00:00Z');
  const res = await request(ctx.app).post(`/goals/${goal.id}/roundups/sweep`).expect(200);
  assert.equal(res.body.totalCents, 25 + 90);
  assert.equal(res.body.entry.feeCents, 2);
  assert.equal(res.body.goal.balanceCents, 113);
  const again = await request(ctx.app).post(`/goals/${goal.id}/roundups/sweep`).expect(200);
  assert.equal(again.body.totalCents, 0);
});

test('statements, reminders and dashboard', async () => {
  const ctx = setup();
  const { user, goal } = await createUserAndGoal(ctx);
  await request(ctx.app).post(`/goals/${goal.id}/deposits`).send({ amount: 100 }).expect(201);

  ctx.clock.now = new Date('2026-01-10T00:00:00Z');
  assert.equal((await request(ctx.app).post('/jobs/notifications')).body.sent.length, 0);

  ctx.clock.now = new Date('2026-02-02T00:00:00Z');
  const { sent } = (await request(ctx.app).post('/jobs/notifications').expect(200)).body;
  assert.deepEqual(sent.map((n) => n.kind).sort(), ['reminder', 'statement']);
  assert.match(sent.find((n) => n.kind === 'reminder').message, /behind/);

  const stmt = (await request(ctx.app).get(`/goals/${goal.id}/statement`).expect(200)).body;
  assert.equal(stmt.moneyInCents, 10000);
  assert.equal(stmt.feesCents, 150);
  assert.equal(stmt.closingBalanceCents, 9850);

  const dash = (await request(ctx.app).get(`/users/${user.id}/dashboard`).expect(200)).body;
  assert.equal(dash.totalSavedCents, 9850);
  assert.equal(dash.goals.length, 1);
  assert.equal(dash.totalFeesPaidCents, 150);
});

test('pays a finished goal to a credit card by BPAY', async () => {
  const ctx = setup();
  const { goal } = await createUserAndGoal(ctx, {
    targetAmount: 100,
    payoutAccount: { method: 'bpay', accountName: 'My Visa', billerCode: '24281', crn: '4564 0012 3456 7890' },
  });
  assert.deepEqual(goal.payoutAccount, { method: 'bpay', accountName: 'My Visa', billerCode: '24281', crn: '4564001234567890' });
  await request(ctx.app).post(`/goals/${goal.id}/deposits`).send({ amount: 102 }).expect(201);
  const payout = ctx.provider.payouts[0];
  assert.equal(payout.to.method, 'bpay');
  assert.equal(payout.reference, '4564001234567890');
  const stmt = (await request(ctx.app).get(`/goals/${goal.id}/statement`)).body;
  assert.match(stmt.transactions.at(-1).description, /BPAY \(biller 24281, ref 4564001234567890\)/);
});

test('pays a finished goal by PayTo to a PayID', async () => {
  const ctx = setup();
  const { goal } = await createUserAndGoal(ctx, {
    targetAmount: 100,
    payoutAccount: { method: 'payto', accountName: 'Card Co', payIdType: 'phone', payId: '0412 345 678' },
  });
  assert.equal(goal.payoutAccount.payId, '+61412345678');
  await request(ctx.app).post(`/goals/${goal.id}/deposits`).send({ amount: 102 }).expect(201);
  assert.equal(ctx.provider.payouts[0].to.method, 'payto');
});

test('validates BPAY and PayTo details', async () => {
  const ctx = setup();
  const { user } = await createUserAndGoal(ctx);
  const base = { name: 'x', targetAmount: 100, timelineMonths: 3 };
  const bad = [
    { method: 'bpay', accountName: 'Visa', billerCode: '12', crn: '123456' },
    { method: 'bpay', accountName: 'Visa', billerCode: '24281', crn: 'abc' },
    { method: 'payto', accountName: 'Co', payIdType: 'email', payId: 'not-an-email' },
    { method: 'payto', accountName: 'Co', payIdType: 'abn', payId: '123' },
    { method: 'cheque', accountName: 'Co' },
  ];
  for (const payoutAccount of bad) {
    await request(ctx.app).post(`/users/${user.id}/goals`).send({ ...base, payoutAccount }).expect(400);
  }
});
