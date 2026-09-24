import { randomUUID, randomBytes } from 'node:crypto';
import { toCents, FEE_CENTS } from '../domain/money.js';
import { buildPlan, addMonths, FREQUENCY_DAYS } from '../domain/savingsPlan.js';
import { calculateRoundups } from '../domain/roundups.js';

export const GOAL_CATEGORIES = ['house', 'credit_card', 'holiday', 'emergency_fund', 'car', 'bills_buffer', 'other'];
export const REMINDER_FREQUENCIES = ['off', 'weekly', 'fortnightly', 'monthly'];
export const STATEMENT_FREQUENCIES = ['off', 'monthly', 'quarterly'];
export const CHANNELS = ['email', 'sms', 'push'];

// Breaking a forced-savings goal early is allowed, but only after a cooling-off period.
export const EARLY_RELEASE_COOLING_OFF_DAYS = 7;

export const GOAL_IDEAS = [
  { category: 'house', name: 'Pay down the home loan', description: 'Save a lump sum and pay it into your mortgage or offset account.' },
  { category: 'credit_card', name: 'Clear the credit card', description: 'Build up the balance, then pay it straight onto your card.' },
  { category: 'emergency_fund', name: 'Rainy day fund', description: 'Three months of expenses, locked away from impulse spending.' },
  { category: 'holiday', name: 'Trip to Japan', description: 'Flights, hotels and ramen, all paid for before you go.' },
  { category: 'car', name: 'Next car', description: 'Buy outright instead of taking out a car loan.' },
  { category: 'bills_buffer', name: 'Bill buffer', description: 'Cover rego, insurance and annual bills without the stress.' },
];

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function requireString(value, field, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw new HttpError(400, `${field} is required`);
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string`);
  return value.trim();
}

function requireAmountCents(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(400, `${field} must be a positive number (dollars)`);
  }
  return toCents(value);
}

function requireOneOf(value, field, options, fallback) {
  const v = value ?? fallback;
  if (!options.includes(v)) throw new HttpError(400, `${field} must be one of: ${options.join(', ')}`);
  return v;
}

function validateAccount(account, field) {
  if (!account || typeof account !== 'object') throw new HttpError(400, `${field} is required`);
  const bsb = requireString(account.bsb, `${field}.bsb`).replace(/[\s-]/g, '');
  const accountNumber = requireString(account.accountNumber, `${field}.accountNumber`).replace(/\s/g, '');
  const accountName = requireString(account.accountName, `${field}.accountName`);
  if (!/^\d{6}$/.test(bsb)) throw new HttpError(400, `${field}.bsb must be 6 digits`);
  if (!/^\d{5,10}$/.test(accountNumber)) throw new HttpError(400, `${field}.accountNumber must be 5-10 digits`);
  return {
    accountName,
    bsb: `${bsb.slice(0, 3)}-${bsb.slice(3)}`,
    accountNumber,
    // e.g. a mortgage or credit card account reference the lender asks for.
    reference: requireString(account.reference, `${field}.reference`, { optional: true }),
  };
}

export class SavingsService {
  constructor({ store, provider, notifier, collectionAccount, clock = () => new Date() }) {
    this.store = store;
    this.provider = provider;
    this.notifier = notifier;
    this.collectionAccount = collectionAccount;
    this.now = clock;
  }

  // ---------------------------------------------------------------- users

  async createUser(input) {
    const email = requireString(input.email, 'email');
    const firstName = requireString(input.firstName, 'firstName');
    const lastName = requireString(input.lastName, 'lastName');
    const mobile = requireString(input.mobile, 'mobile', { optional: true });
    const { providerUserId } = await this.provider.createUser({ email, mobile, firstName, lastName });
    const user = {
      id: randomUUID(),
      email,
      mobile,
      firstName,
      lastName,
      providerUserId,
      // Unique reference the employer quotes when paying part of a salary to Oinkster.
      payrollReference: `OINK${randomBytes(4).toString('hex').toUpperCase()}`,
      createdAt: this.now().toISOString(),
    };
    return this.store.putUser(user);
  }

  getUser(id) {
    const user = this.store.getUser(id);
    if (!user) throw new HttpError(404, 'User not found');
    return user;
  }

  async bankConnectUrl(userId) {
    const user = this.getUser(userId);
    return { url: await this.provider.getConsentUrl(user.providerUserId) };
  }

  async linkedAccounts(userId) {
    const user = this.getUser(userId);
    return this.provider.listAccounts(user.providerUserId);
  }

  /** What the user gives their payroll team to split their pay into Oinkster. */
  payrollInstructions(userId) {
    const user = this.getUser(userId);
    const goals = this.store.goalsForUser(userId).filter((g) => g.status === 'active');
    return {
      accountName: this.collectionAccount.accountName,
      bsb: this.collectionAccount.bsb,
      accountNumber: this.collectionAccount.accountNumber,
      reference: user.payrollReference,
      howItWorks:
        'Ask your payroll team to send a fixed amount from each pay to this account, quoting the reference. ' +
        'Oinkster splits each payment across your goals using their payroll allocation percentages.',
      allocations: goals.map((g) => ({ goalId: g.id, name: g.name, percent: g.payrollAllocationPercent })),
      suggestedPerPayCents: goals.reduce((sum, g) => sum + this.planFor(g).requiredPerPeriodCents.fortnightly, 0),
      fees: FEE_CENTS,
    };
  }

  // ---------------------------------------------------------------- goals

  createGoal(userId, input) {
    this.getUser(userId);
    const now = this.now();
    const name = requireString(input.name, 'name');
    const category = requireOneOf(input.category, 'category', GOAL_CATEGORIES, 'other');
    const targetCents = requireAmountCents(input.targetAmount, 'targetAmount');

    let deadline;
    if (input.deadline) {
      deadline = new Date(input.deadline);
      if (Number.isNaN(deadline.getTime())) throw new HttpError(400, 'deadline must be an ISO date');
    } else if (input.timelineMonths !== undefined) {
      if (!Number.isInteger(input.timelineMonths) || input.timelineMonths < 1 || input.timelineMonths > 120) {
        throw new HttpError(400, 'timelineMonths must be a whole number between 1 and 120');
      }
      deadline = addMonths(now, input.timelineMonths);
    } else {
      throw new HttpError(400, 'Provide either deadline or timelineMonths');
    }
    if (deadline <= now) throw new HttpError(400, 'deadline must be in the future');

    const payoutAccount = validateAccount(input.payoutAccount, 'payoutAccount');

    const n = input.notifications ?? {};
    const notifications = {
      reminders: requireOneOf(n.reminders, 'notifications.reminders', REMINDER_FREQUENCIES, 'off'),
      statements: requireOneOf(n.statements, 'notifications.statements', STATEMENT_FREQUENCIES, 'monthly'),
      channel: requireOneOf(n.channel, 'notifications.channel', CHANNELS, 'email'),
      lastReminderAt: null,
      lastStatementAt: null,
    };

    const r = input.roundups ?? {};
    const roundups = {
      enabled: r.enabled === true,
      multipleCents: r.roundTo !== undefined ? requireAmountCents(r.roundTo, 'roundups.roundTo') : 100,
      lastSweptAt: now.toISOString(),
    };

    const pct = input.payrollAllocationPercent ?? 0;
    if (typeof pct !== 'number' || pct < 0 || pct > 100) {
      throw new HttpError(400, 'payrollAllocationPercent must be between 0 and 100');
    }
    const otherPct = this.store
      .goalsForUser(userId)
      .filter((g) => g.status === 'active')
      .reduce((s, g) => s + g.payrollAllocationPercent, 0);
    if (otherPct + pct > 100) {
      throw new HttpError(400, `payrollAllocationPercent would take total above 100% (currently ${otherPct}%)`);
    }

    const goal = {
      id: randomUUID(),
      userId,
      name,
      category,
      targetCents,
      balanceCents: 0,
      startDate: now.toISOString(),
      deadline: deadline.toISOString(),
      payoutAccount,
      autoPayout: input.autoPayout !== false,
      payrollAllocationPercent: pct,
      notifications,
      roundups,
      earlyRelease: null,
      status: 'active',
      createdAt: now.toISOString(),
    };
    return this.store.putGoal(goal);
  }

  getGoal(goalId) {
    const goal = this.store.getGoal(goalId);
    if (!goal) throw new HttpError(404, 'Goal not found');
    return goal;
  }

  planFor(goal) {
    return buildPlan({
      targetCents: goal.targetCents,
      balanceCents: goal.balanceCents,
      startDate: goal.startDate,
      deadline: goal.deadline,
      now: this.now(),
    });
  }

  goalView(goal) {
    return { ...goal, lock: this.lockState(goal), plan: this.planFor(goal) };
  }

  updateGoalSettings(goalId, input) {
    const goal = this.getGoal(goalId);
    if (input.notifications) {
      const n = input.notifications;
      goal.notifications.reminders = requireOneOf(n.reminders, 'notifications.reminders', REMINDER_FREQUENCIES, goal.notifications.reminders);
      goal.notifications.statements = requireOneOf(n.statements, 'notifications.statements', STATEMENT_FREQUENCIES, goal.notifications.statements);
      goal.notifications.channel = requireOneOf(n.channel, 'notifications.channel', CHANNELS, goal.notifications.channel);
    }
    if (input.roundups) {
      if (input.roundups.enabled !== undefined) goal.roundups.enabled = input.roundups.enabled === true;
      if (input.roundups.roundTo !== undefined) goal.roundups.multipleCents = requireAmountCents(input.roundups.roundTo, 'roundups.roundTo');
    }
    if (input.payoutAccount) goal.payoutAccount = validateAccount(input.payoutAccount, 'payoutAccount');
    // Target and deadline are deliberately not editable downwards: that's the "forced" part.
    return this.store.putGoal(goal);
  }

  /**
   * Forced savings: money is locked until the target is reached or the deadline
   * passes. The only way out early is an early-release request plus a cooling-off period.
   */
  lockState(goal) {
    const now = this.now();
    if (goal.balanceCents >= goal.targetCents) return { locked: false, reason: 'target_reached' };
    if (now >= new Date(goal.deadline)) return { locked: false, reason: 'deadline_passed' };
    if (goal.earlyRelease && now >= new Date(goal.earlyRelease.availableAt)) {
      return { locked: false, reason: 'early_release' };
    }
    return {
      locked: true,
      reason: goal.earlyRelease ? 'early_release_cooling_off' : 'locked_until_target_or_deadline',
      unlocksAt: goal.earlyRelease?.availableAt ?? goal.deadline,
    };
  }

  requestEarlyRelease(goalId, input) {
    const goal = this.getGoal(goalId);
    if (goal.status !== 'active') throw new HttpError(409, `Goal is ${goal.status}`);
    if (!this.lockState(goal).locked) throw new HttpError(409, 'Goal is already unlocked');
    if (goal.earlyRelease) throw new HttpError(409, 'Early release already requested');
    const now = this.now();
    goal.earlyRelease = {
      reason: requireString(input.reason, 'reason'),
      requestedAt: now.toISOString(),
      availableAt: new Date(now.getTime() + EARLY_RELEASE_COOLING_OFF_DAYS * DAY_MS).toISOString(),
    };
    this.store.putGoal(goal);
    return this.goalView(goal);
  }

  cancelEarlyRelease(goalId) {
    const goal = this.getGoal(goalId);
    goal.earlyRelease = null;
    this.store.putGoal(goal);
    return this.goalView(goal);
  }

  // ---------------------------------------------------------------- money in

  #credit(goal, { amountCents, source, description, providerPaymentId }) {
    const entry = this.store.addLedgerEntry({
      id: randomUUID(),
      goalId: goal.id,
      userId: goal.userId,
      type: 'deposit',
      source,
      amountCents,
      feeCents: FEE_CENTS,
      description,
      providerPaymentId,
      createdAt: this.now().toISOString(),
    });
    goal.balanceCents += amountCents;
    this.store.putGoal(goal);
    return entry;
  }

  #assertActive(goal) {
    if (goal.status !== 'active') throw new HttpError(409, `Goal is ${goal.status}; it can't take deposits`);
  }

  /** One-off or top-up deposit pulled from the user's linked bank account (PayTo / direct debit). */
  async deposit(goalId, input) {
    const goal = this.getGoal(goalId);
    this.#assertActive(goal);
    const amountCents = requireAmountCents(input.amount, 'amount');
    const user = this.getUser(goal.userId);
    const { providerPaymentId } = await this.provider.createDebit({
      providerUserId: user.providerUserId,
      amountCents,
      description: `Oinkster: ${goal.name}`,
      reference: randomUUID(),
    });
    const entry = this.#credit(goal, { amountCents, source: 'bank_debit', description: 'Deposit from linked account', providerPaymentId });
    const payout = await this.#maybeAutoPayout(goal);
    return { entry, goal: this.goalView(goal), payout };
  }

  /**
   * Incoming credit to the Oinkster collection account (e.g. employer payroll split
   * or a manual bank transfer / PayID payment). Called by the bank or provider webhook.
   */
  async receiveIncomingPayment(input) {
    const reference = requireString(input.reference, 'reference').toUpperCase().replace(/\s/g, '');
    const amountCents = requireAmountCents(input.amount, 'amount');
    const source = requireOneOf(input.source, 'source', ['payroll', 'bank_transfer'], 'payroll');
    const user = this.store.findUserByPayrollReference(reference);
    if (!user) throw new HttpError(404, `No user for reference ${reference}`);

    const goals = this.store.goalsForUser(user.id).filter((g) => g.status === 'active');
    if (goals.length === 0) throw new HttpError(409, 'User has no active goals to deposit into');

    // Split by payroll allocation. Anything unallocated goes to the oldest active goal.
    const allocated = goals.map((g) => ({ goal: g, cents: Math.floor((amountCents * g.payrollAllocationPercent) / 100) }));
    const remainder = amountCents - allocated.reduce((s, a) => s + a.cents, 0);
    allocated[0].cents += remainder;

    const entries = [];
    const payouts = [];
    for (const { goal, cents } of allocated) {
      if (cents <= 0) continue;
      entries.push(this.#credit(goal, {
        amountCents: cents,
        source,
        description: source === 'payroll' ? `Pay from ${input.payerName ?? 'employer'}` : 'Bank transfer',
        providerPaymentId: input.paymentId,
      }));
      const payout = await this.#maybeAutoPayout(goal);
      if (payout) payouts.push(payout);
    }
    return { userId: user.id, entries, payouts };
  }

  /** Pull card purchases since the last sweep, round them up and save the spare change. */
  async sweepRoundups(goalId) {
    const goal = this.getGoal(goalId);
    this.#assertActive(goal);
    if (!goal.roundups.enabled) throw new HttpError(409, 'Round-ups are not enabled for this goal');
    const user = this.getUser(goal.userId);
    const txs = await this.provider.listTransactions(user.providerUserId, { since: goal.roundups.lastSweptAt });
    const { items, totalCents } = calculateRoundups(txs, goal.roundups.multipleCents);
    goal.roundups.lastSweptAt = this.now().toISOString();
    this.store.putGoal(goal);
    if (totalCents === 0) return { items, totalCents, entry: null, goal: this.goalView(goal) };

    const { providerPaymentId } = await this.provider.createDebit({
      providerUserId: user.providerUserId,
      amountCents: totalCents,
      description: `Oinkster round-ups: ${goal.name}`,
      reference: randomUUID(),
    });
    const entry = this.#credit(goal, {
      amountCents: totalCents,
      source: 'roundup',
      description: `Round-ups from ${items.length} purchase(s)`,
      providerPaymentId,
    });
    const payout = await this.#maybeAutoPayout(goal);
    return { items, totalCents, entry, goal: this.goalView(goal), payout };
  }

  // ---------------------------------------------------------------- money out

  async #maybeAutoPayout(goal) {
    if (!goal.autoPayout || goal.status !== 'active' || goal.balanceCents < goal.targetCents) return null;
    return this.#payout(goal, 'Goal reached');
  }

  async #payout(goal, why) {
    const amountCents = goal.balanceCents;
    const to = goal.payoutAccount;
    const { providerPaymentId, status } = await this.provider.createPayout({
      amountCents,
      to,
      description: `Oinkster: ${goal.name}`,
      reference: to.reference ?? goal.id,
    });
    const entry = this.store.addLedgerEntry({
      id: randomUUID(),
      goalId: goal.id,
      userId: goal.userId,
      type: 'payout',
      source: 'payout',
      amountCents: -amountCents,
      feeCents: FEE_CENTS,
      description: `${why}: paid to ${to.accountName} (${to.bsb} ${to.accountNumber})`,
      providerPaymentId,
      createdAt: this.now().toISOString(),
    });
    goal.balanceCents = 0;
    goal.status = 'paid_out';
    goal.completedAt = this.now().toISOString();
    this.store.putGoal(goal);
    await this.notifier.send({
      userId: goal.userId,
      channel: goal.notifications.channel,
      kind: 'goal_paid_out',
      message: `Nice work! ${goal.name} is done and ${(amountCents / 100).toFixed(2)} is on its way to ${to.accountName}.`,
    });
    return { entry, providerStatus: status };
  }

  /** Manually pay the goal out to its nominated account. Only possible once unlocked. */
  async payout(goalId) {
    const goal = this.getGoal(goalId);
    this.#assertActive(goal);
    const lock = this.lockState(goal);
    if (lock.locked) throw new HttpError(423, 'This goal is locked', lock);
    if (goal.balanceCents === 0) throw new HttpError(409, 'Nothing to pay out');
    const reasons = { target_reached: 'Goal reached', deadline_passed: 'Timeline ended', early_release: 'Early release' };
    const result = await this.#payout(goal, reasons[lock.reason]);
    return { ...result, goal: this.goalView(goal) };
  }

  // ---------------------------------------------------------------- reporting

  statement(goalId, { from, to } = {}) {
    const goal = this.getGoal(goalId);
    const toDate = to ? new Date(to) : this.now();
    const fromDate = from ? new Date(from) : new Date(goal.startDate);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new HttpError(400, 'from/to must be ISO dates');
    }
    const ledger = this.store.ledgerForGoal(goalId);
    const before = ledger.filter((e) => new Date(e.createdAt) < fromDate);
    const within = ledger.filter((e) => new Date(e.createdAt) >= fromDate && new Date(e.createdAt) <= toDate);
    const openingCents = before.reduce((s, e) => s + e.amountCents, 0);
    const bySource = {};
    for (const e of within) bySource[e.source] = (bySource[e.source] ?? 0) + e.amountCents;
    return {
      goalId,
      goalName: goal.name,
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      openingBalanceCents: openingCents,
      closingBalanceCents: openingCents + within.reduce((s, e) => s + e.amountCents, 0),
      totalsBySourceCents: bySource,
      feesCents: within.reduce((s, e) => s + e.feeCents, 0),
      transactions: within,
    };
  }

  dashboard(userId) {
    const user = this.getUser(userId);
    const goals = this.store.goalsForUser(userId).map((g) => this.goalView(g));
    const active = goals.filter((g) => g.status === 'active');
    const recent = goals
      .flatMap((g) => this.store.ledgerForGoal(g.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10);
    return {
      user: { id: user.id, firstName: user.firstName },
      totalSavedCents: active.reduce((s, g) => s + g.balanceCents, 0),
      totalTargetCents: active.reduce((s, g) => s + g.targetCents, 0),
      totalFeesPaidCents: 0,
      goals,
      recentActivity: recent,
    };
  }

  // ---------------------------------------------------------------- reminders & statements

  /** Run from a daily cron: sends any reminders and statements that are due. */
  async runScheduledNotifications() {
    const now = this.now();
    const sent = [];
    const statementDays = { monthly: FREQUENCY_DAYS.monthly, quarterly: FREQUENCY_DAYS.monthly * 3 };
    for (const goal of this.store.allGoals()) {
      if (goal.status !== 'active') continue;
      const n = goal.notifications;
      const due = (last, days) => now.getTime() - new Date(last ?? goal.startDate).getTime() >= days * DAY_MS;

      if (n.reminders !== 'off' && due(n.lastReminderAt, FREQUENCY_DAYS[n.reminders])) {
        const plan = this.planFor(goal);
        const amount = (plan.requiredPerPeriodCents[n.reminders] / 100).toFixed(2);
        const message = plan.onTrack
          ? `You're on track for ${goal.name}: ${plan.percentComplete}% saved. Keep it up with $${amount} this ${n.reminders === 'monthly' ? 'month' : 'period'}.`
          : `${goal.name} is a little behind. Put in $${amount} this ${n.reminders === 'monthly' ? 'month' : 'period'} to catch up.`;
        sent.push(await this.notifier.send({ userId: goal.userId, channel: n.channel, kind: 'reminder', goalId: goal.id, message }));
        n.lastReminderAt = now.toISOString();
      }

      if (n.statements !== 'off' && due(n.lastStatementAt, statementDays[n.statements])) {
        const stmt = this.statement(goal.id, { from: n.lastStatementAt ?? goal.startDate, to: now.toISOString() });
        sent.push(await this.notifier.send({
          userId: goal.userId,
          channel: 'email',
          kind: 'statement',
          goalId: goal.id,
          message: `Your ${n.statements} statement for ${goal.name}`,
          attachment: stmt,
        }));
        n.lastStatementAt = now.toISOString();
      }
      this.store.putGoal(goal);
    }
    return sent;
  }
}
