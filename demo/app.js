// Oinkster clickable demo. Runs the real savings engine (src/) in the browser,
// with the mock bank standing in for Basiq and a "time machine" clock.
import { SavingsService, GOAL_IDEAS, GOAL_CATEGORIES, HttpError, describeDestination } from './engine/services/savings.js';
import { Notifier } from './engine/services/notifier.js';
import { MockProvider } from './engine/providers/mock.js';
import { Store } from './engine/store.js';
import { formatAud, depositFee } from './engine/domain/money.js';

const KEYS = { data: 'oinkster-demo-data', bank: 'oinkster-demo-bank', offset: 'oinkster-demo-offset' };
const DAY_MS = 86_400_000;

// ------------------------------------------------------------ persistence

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: demo still works in memory */ }
}

let offsetMs = load(KEYS.offset, 0);
const clock = () => new Date(Date.now() + offsetMs);

const store = new Store({ data: load(KEYS.data, undefined), persist: (d) => save(KEYS.data, d) });

const bank = new MockProvider();
const savedBank = load(KEYS.bank, null);
if (savedBank) {
  bank.users = new Map(savedBank.users);
  bank.transactions = new Map(savedBank.transactions);
  bank.debits = savedBank.debits;
  bank.payouts = savedBank.payouts;
}
function saveBank() {
  save(KEYS.bank, { users: [...bank.users], transactions: [...bank.transactions], debits: bank.debits, payouts: bank.payouts });
}

const notifier = new Notifier({ store, clock });
const service = new SavingsService({
  store,
  provider: bank,
  notifier,
  clock,
  collectionAccount: { accountName: 'Oinkster Savings Trust', bsb: '033-000', accountNumber: '10203040' },
});

const FEE_PCT = `${service.depositFeeBps / 100}%`;
const feeLine = (grossCents) => {
  const fee = depositFee(grossCents, service.depositFeeBps);
  return `${FEE_PCT} fee: ${aud(fee)} · ${aud(grossCents - fee)} is saved`;
};
const METHOD = {
  bank_transfer: { icon: '🏦', label: 'Bank transfer' },
  bpay: { icon: '🧾', label: 'BPAY' },
  payto: { icon: '⚡', label: 'PayTo' },
};
const destIcon = (to) => METHOD[to.method ?? 'bank_transfer'].icon;

const currentUser = () => store.allUsers()[0] ?? null;
const paidOutCents = (goalId) => -(store.ledgerForGoal(goalId).find((e) => e.type === 'payout')?.amountCents ?? 0);

// ------------------------------------------------------------ helpers

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const aud = (cents) => formatAud(cents);
const audShort = (cents) => (cents % 100 === 0 ? aud(cents).replace(/\.00$/, '') : aud(cents));
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const CATEGORY = {
  house: { icon: '🏠', label: 'Home loan' },
  credit_card: { icon: '💳', label: 'Credit card' },
  holiday: { icon: '✈️', label: 'Holiday' },
  emergency_fund: { icon: '☂️', label: 'Emergency fund' },
  car: { icon: '🚗', label: 'Car' },
  bills_buffer: { icon: '🧾', label: 'Bill buffer' },
  other: { icon: '⭐', label: 'Something else' },
};
const SOURCE_LABEL = { bank_debit: 'From bank', payroll: 'Payday', bank_transfer: 'Transfer', roundup: 'Round-ups', payout: 'Paid out' };

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  const box = document.getElementById('toasts');
  box.append(el);
  while (box.children.length > 2) box.firstElementChild.remove();
  setTimeout(() => el.remove(), 4200);
}

async function run(action, successMessage) {
  try {
    const result = await action();
    saveBank();
    if (successMessage) toast(typeof successMessage === 'function' ? successMessage(result) : successMessage, 'success');
    render();
    return result;
  } catch (err) {
    if (err instanceof HttpError && err.status === 423) {
      toast(`🔒 Locked. This money stays put until ${fmtDate(err.details.unlocksAt)}, or until you hit your target.`, 'error');
    } else {
      toast(err.message ?? 'Something went wrong', 'error');
      if (!(err instanceof HttpError)) console.error(err);
    }
    return null;
  }
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

let pigSeq = 0;
function pigSvg(percent, { className = '' } = {}) {
  const id = `pig${++pigSeq}`;
  const p = Math.max(0, Math.min(percent, 100));
  const top = 14, bottom = 148;
  const fillY = bottom - ((bottom - top) * p) / 100;
  const shapes = `
    <ellipse cx="95" cy="86" rx="68" ry="52"/>
    <rect x="152" y="68" width="26" height="32" rx="10"/>
    <path d="M122 44 L138 14 L156 52 Z"/>
    <rect x="48" y="118" width="20" height="30" rx="6"/>
    <rect x="118" y="118" width="20" height="30" rx="6"/>`;
  return `
  <div class="pig ${className}">
    <svg viewBox="0 0 200 160" role="img" aria-label="Piggy bank ${p}% full">
      <defs><clipPath id="${id}">${shapes}</clipPath></defs>
      <path d="M28 84 c-14 -2 -14 -18 -2 -18 c10 0 8 14 -4 12" fill="none" stroke="var(--pink-deep)" stroke-width="4" stroke-linecap="round"/>
      <g clip-path="url(#${id})">
        <rect x="0" y="0" width="200" height="160" fill="var(--pig-empty)"/>
        <rect class="pig-fill" x="0" y="${fillY}" width="200" height="${160 - fillY}" fill="var(--pink)"/>
        <rect class="pig-fill" x="0" y="${fillY}" width="200" height="4" fill="var(--pink-deep)" opacity="0.5"/>
      </g>
      <g fill="none" stroke="var(--pink-deep)" stroke-width="3.5" stroke-linejoin="round">${shapes}</g>
      <rect x="80" y="33" width="34" height="6" rx="3" fill="var(--pink-deep)"/>
      <circle cx="140" cy="70" r="4.5" fill="var(--ink)"/>
      <circle cx="161" cy="81" r="2.6" fill="var(--pink-deep)"/>
      <circle cx="170" cy="81" r="2.6" fill="var(--pink-deep)"/>
    </svg>
  </div>`;
}

function statusChips(goal) {
  const chips = [];
  if (goal.status === 'paid_out') {
    chips.push('<span class="pill chip-done">✓ Paid out</span>');
    return chips.join('');
  }
  if (goal.lock.locked) {
    chips.push(goal.lock.reason === 'early_release_cooling_off'
      ? `<span class="pill chip-warn">⏳ Cooling off until ${fmtDate(goal.lock.unlocksAt)}</span>`
      : '<span class="pill chip-locked">🔒 Locked</span>');
  } else {
    chips.push('<span class="pill chip-ok">🔓 Unlocked</span>');
  }
  chips.push(goal.plan.onTrack ? '<span class="pill chip-ok">On track</span>' : '<span class="pill chip-warn">A little behind</span>');
  if (goal.roundups.enabled) chips.push('<span class="pill chip-locked">🪙 Round-ups</span>');
  return chips.join('');
}

// ------------------------------------------------------------ views

function viewWelcome() {
  return `
  <section class="hero">
    <div>
      <h1>Save smarter, not harder.</h1>
      <p class="lede">Oinkster is a piggy bank for grown-ups. Set a goal, lock the money away until you hit it, and we pay it straight onto your mortgage, your credit card or your next adventure. One simple 1.5% fee on money in, and nothing else.</p>
      <form class="card" id="signup-form">
        <h2>Start the demo</h2>
        <div class="row">
          <div class="field"><label for="firstName">First name</label><input id="firstName" name="firstName" required autocomplete="given-name" value="Andrew"></div>
          <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required value="andrew@example.com"></div>
        </div>
        <button class="btn btn-block" type="submit">Create my piggy bank</button>
        <div class="or">or</div>
        <button class="btn btn-ghost btn-block" type="button" id="sample-btn">Load a sample account with goals and savings</button>
      </form>
    </div>
    <div class="hero-pig">${pigSvg(62)}</div>
  </section>
  <div class="features">
    <div class="feature"><strong>🎯 Set a goal</strong><span>Pay off the house, clear the card, or book Japan. Pick a target and a timeline.</span></div>
    <div class="feature"><strong>🔒 Locked in</strong><span>Money stays put until you get there. Breaking a goal early takes a 7-day cooling-off.</span></div>
    <div class="feature"><strong>💼 Straight from your pay</strong><span>Your employer sends part of each pay straight to your goals.</span></div>
    <div class="feature"><strong>🪙 Round-ups</strong><span>Spare change from every tap of your card adds up.</span></div>
  </div>`;
}

function viewDashboard(user) {
  const dash = service.dashboard(user.id);
  const payroll = service.payrollInstructions(user.id);
  const notes = store.notificationsForUser(user.id).slice().reverse().slice(0, 8);
  const active = dash.goals.filter((g) => g.status === 'active');
  const pct = dash.totalTargetCents ? Math.floor((dash.totalSavedCents / dash.totalTargetCents) * 100) : 0;

  const goalCards = dash.goals.length
    ? dash.goals.map((g) => `
      <a class="card goal-card" href="#/goal/${g.id}">
        <div class="pig-mini">${pigSvg(g.status === 'paid_out' ? Math.floor((paidOutCents(g.id) / g.targetCents) * 100) : g.plan.percentComplete)}</div>
        <div class="goal-card-body">
          <div class="muted small">${CATEGORY[g.category].icon} ${CATEGORY[g.category].label}</div>
          <h3>${esc(g.name)}</h3>
          ${g.status === 'paid_out'
            ? `<div class="small">Paid ${aud(paidOutCents(g.id))} to ${esc(g.payoutAccount.accountName)} ${g.payoutAccount.method === 'bpay' ? 'by BPAY' : g.payoutAccount.method === 'payto' ? 'by PayTo' : ''} on ${fmtDate(g.completedAt)} 🎉</div>`
            : `<div class="progress" aria-hidden="true"><span style="width:${g.plan.percentComplete}%"></span></div>
               <div class="small num"><strong>${aud(g.balanceCents)}</strong> of ${audShort(g.targetCents)} · ${g.plan.daysLeft} days left</div>`}
          <div class="chips">${statusChips(g)}</div>
        </div>
      </a>`).join('')
    : `<div class="empty"><p>No goals yet. What are you saving for?</p><a class="btn" href="#/new">Create your first goal</a></div>`;

  return `
  <h1>G'day, ${esc(user.firstName)} 👋</h1>
  <div class="card summary">
    <div>
      <div class="muted small">Total saved</div>
      <div class="big-number num">${aud(dash.totalSavedCents)}</div>
      <div class="muted small num">${active.length} active goal${active.length === 1 ? '' : 's'} · ${pct}% of ${audShort(dash.totalTargetCents)}</div>
    </div>
    <div><span class="fee-badge">Fees paid: ${aud(dash.totalFeesPaidCents)}</span><div class="hint">A flat ${FEE_PCT} on money in. No account, payout or exit fees.</div></div>
  </div>

  <div class="section-head"><h2>Your goals</h2><a class="btn" href="#/new">+ New goal</a></div>
  <div class="grid grid-2">${goalCards}</div>

  <div class="grid grid-2" style="margin-top:28px">
    <section class="card">
      <h2>💼 Save straight from your pay</h2>
      <p class="muted small">Give these details to your payroll team. Every payday, the amount they send is split across your goals.</p>
      <dl class="kv">
        <dt>Account name</dt><dd>${esc(payroll.accountName)}</dd>
        <dt>BSB</dt><dd>${esc(payroll.bsb)}</dd>
        <dt>Account</dt><dd>${esc(payroll.accountNumber)}</dd>
        <dt>Reference</dt><dd><span class="ref">${esc(payroll.reference)}</span></dd>
        ${payroll.allocations.length ? `<dt>Split</dt><dd>${payroll.allocations.map((a) => `${esc(a.name)} ${a.percent}%`).join(' · ')}</dd>` : ''}
      </dl>
      ${active.length ? `
      <form id="payday-form" class="row" style="margin-top:14px">
        <div class="field" style="margin:0"><label for="payday-amount">Simulate a payday</label>
          <div class="money-input"><input id="payday-amount" name="amount" type="number" min="1" step="0.01" value="${(Math.max(payroll.suggestedPerPayCents, 100) / 100).toFixed(0)}" inputmode="decimal"></div></div>
        <button class="btn" type="submit">Payday 💸</button>
      </form>
      <p class="hint" id="payday-fee"></p>
      <p class="hint">Suggested per fortnightly pay to stay on track: ${aud(payroll.suggestedPerPayCents)}</p>` : ''}
    </section>

    <section class="card">
      <h2>📬 Inbox</h2>
      ${notes.length ? `<ul class="inbox">${notes.map((n) => `
        <li><span class="inbox-icon">${n.kind === 'statement' ? '🧾' : n.kind === 'goal_paid_out' ? '🎉' : '🔔'}</span>
          <div><div>${esc(n.message)}</div><div class="inbox-meta">${fmtDateTime(n.sentAt)} · ${esc(n.channel)}</div></div></li>`).join('')}</ul>`
        : '<p class="muted small">Reminders and statements will show up here. Try the time machine above to jump ahead a week or a month.</p>'}
    </section>
  </div>`;
}

function viewNewGoal(user, prefill = {}) {
  const hasOthers = store.goalsForUser(user.id).some((g) => g.status === 'active');
  const usedPct = store.goalsForUser(user.id).filter((g) => g.status === 'active').reduce((s, g) => s + g.payrollAllocationPercent, 0);
  const v = { name: '', category: 'other', target: 5000, months: 6, ...prefill };
  const method = v.method ?? (v.category === 'credit_card' ? 'bpay' : 'bank_transfer');
  return `
  <a class="back" href="#/">← Back</a>
  <h1>New savings goal</h1>
  <p class="muted">Need an idea?</p>
  <div class="ideas">${GOAL_IDEAS.map((i, idx) => `<button type="button" class="chip-btn" data-idea="${idx}">${CATEGORY[i.category].icon} ${esc(i.name)}</button>`).join('')}</div>

  <form id="goal-form" class="card">
    <fieldset>
      <legend>The goal</legend>
      <div class="field"><label for="g-name">What are you saving for?</label><input id="g-name" name="name" required maxlength="60" value="${esc(v.name)}" placeholder="e.g. Pay off the credit card"></div>
      <div class="row">
        <div class="field"><label for="g-cat">Type</label><select id="g-cat" name="category">${GOAL_CATEGORIES.map((c) => `<option value="${c}" ${c === v.category ? 'selected' : ''}>${CATEGORY[c].icon} ${CATEGORY[c].label}</option>`).join('')}</select></div>
        <div class="field"><label for="g-target">Savings limit</label><div class="money-input"><input id="g-target" name="targetAmount" type="number" min="1" step="1" required value="${v.target}" inputmode="decimal"></div></div>
      </div>
      <div class="field"><label for="g-months">Timeline: <span class="range-value" id="months-out">${v.months} months</span></label>
        <input id="g-months" name="timelineMonths" type="range" min="1" max="36" value="${v.months}">
        <div class="hint" id="plan-hint"></div></div>
    </fieldset>

    <fieldset>
      <legend>Where the money goes when you're done</legend>
      <div class="field">
        <span class="label">Pay it by</span>
        <div class="tabs" role="radiogroup" aria-label="Payment method">
          ${Object.entries(METHOD).map(([k, m]) => `<label class="chip-btn method-chip"><input type="radio" name="method" value="${k}" ${k === method ? 'checked' : ''}> ${m.icon} ${m.label}</label>`).join('')}
        </div>
      </div>
      <div class="field"><label for="p-name">${method === 'bank_transfer' ? 'Account name' : 'Biller or payee name'}</label><input id="p-name" name="accountName" required value="${v.category === 'credit_card' ? 'My Visa' : v.category === 'house' ? 'Home loan' : 'Everyday account'}"></div>
      <div data-method="bank_transfer" ${method === 'bank_transfer' ? '' : 'hidden'}>
        <div class="row">
          <div class="field"><label for="p-bsb">BSB</label><input id="p-bsb" name="bsb" required inputmode="numeric" value="062-000" placeholder="000-000"></div>
          <div class="field"><label for="p-acc">Account number</label><input id="p-acc" name="accountNumber" required inputmode="numeric" value="12345678"></div>
        </div>
        <div class="field"><label for="p-ref">Payment reference (optional)</label><input id="p-ref" name="reference" placeholder="e.g. loan number"></div>
      </div>
      <div data-method="bpay" ${method === 'bpay' ? '' : 'hidden'}>
        <div class="row">
          <div class="field"><label for="p-biller">Biller code</label><input id="p-biller" name="billerCode" required inputmode="numeric" value="24281"></div>
          <div class="field"><label for="p-crn">Reference number (CRN)</label><input id="p-crn" name="crn" required inputmode="numeric" value="4564001234567890"></div>
        </div>
        <p class="hint">Both are on your bill or card statement, next to the BPAY logo.</p>
      </div>
      <div data-method="payto" ${method === 'payto' ? '' : 'hidden'}>
        <div class="row">
          <div class="field"><label for="p-idtype">PayID type</label><select id="p-idtype" name="payIdType"><option value="email">Email</option><option value="phone">Mobile</option><option value="abn">ABN</option></select></div>
          <div class="field"><label for="p-payid">Biller's PayID</label><input id="p-payid" name="payId" required value="payments@mycardco.com.au"></div>
        </div>
        <div class="field"><label for="p-pref">Payment reference (optional)</label><input id="p-pref" name="payRef" placeholder="e.g. card number"></div>
        <p class="hint">Paid instantly over the NPP under a PayTo agreement with your biller.</p>
      </div>
    </fieldset>

    <fieldset>
      <legend>How you'll save</legend>
      <div class="field"><label for="g-pay">Share of each payday (%)</label><input id="g-pay" name="payrollAllocationPercent" type="number" min="0" max="${100 - usedPct}" value="${hasOthers ? Math.min(50, 100 - usedPct) : 100}">
        <div class="hint">${usedPct}% of your pay split is already allocated to other goals.</div></div>
      <div class="field"><label class="check"><input type="checkbox" name="roundups" checked> Round up my card purchases to the nearest dollar</label></div>
    </fieldset>

    <fieldset>
      <legend>Keep me posted</legend>
      <div class="row">
        <div class="field"><label for="n-rem">Reminders</label><select id="n-rem" name="reminders"><option value="off">Off</option><option value="weekly">Weekly</option><option value="fortnightly" selected>Fortnightly</option><option value="monthly">Monthly</option></select></div>
        <div class="field"><label for="n-st">Statements</label><select id="n-st" name="statements"><option value="off">Off</option><option value="monthly" selected>Monthly</option><option value="quarterly">Quarterly</option></select></div>
        <div class="field"><label for="n-ch">Send by</label><select id="n-ch" name="channel"><option value="email">Email</option><option value="sms">SMS</option><option value="push" selected>Push</option></select></div>
      </div>
    </fieldset>

    <button class="btn btn-block" type="submit">Lock it in 🔒</button>
  </form>`;
}

function viewGoal(goalId, ui) {
  const goal = service.goalView(service.getGoal(goalId));
  const { plan, lock } = goal;
  const done = goal.status === 'paid_out';
  const paidCents = done ? paidOutCents(goal.id) : 0;
  const shownPct = done ? Math.min(Math.floor((paidCents / goal.targetCents) * 100), 100) : plan.percentComplete;
  const user = service.getUser(goal.userId);
  const ledger = store.ledgerForGoal(goal.id).slice().reverse();
  const purchases = (bank.transactions.get(user.providerUserId) ?? [])
    .filter((t) => new Date(t.postDate) > new Date(goal.roundups.lastSweptAt))
    .slice(-6);
  const pendingRoundups = purchases.reduce((s, t) => {
    const r = (-t.amountCents) % goal.roundups.multipleCents;
    return s + (r ? goal.roundups.multipleCents - r : 0);
  }, 0);

  let lockBox;
  if (done) {
    lockBox = `<div class="lock-box open"><span class="icon">🎉</span><div><strong>${paidCents >= goal.targetCents ? 'Goal complete!' : 'Paid out early'}</strong><br><span class="small">${aud(paidCents)} was paid to ${esc(goal.payoutAccount.accountName)} on ${fmtDate(goal.completedAt)}.</span></div></div>`;
  } else if (lock.locked && lock.reason === 'early_release_cooling_off') {
    lockBox = `<div class="lock-box cooling"><span class="icon">⏳</span><div><strong>Early release requested</strong><br><span class="small">Reason: “${esc(goal.earlyRelease.reason)}”. You can take the money out from <strong>${fmtDate(lock.unlocksAt)}</strong>. Changed your mind? Cancel and keep saving.</span></div></div>
      <div class="row"><button class="btn btn-secondary" id="cancel-release">Cancel request, keep saving</button><button class="btn btn-danger" id="payout-btn">Try to withdraw</button></div>`;
  } else if (lock.locked) {
    lockBox = `<div class="lock-box locked"><span class="icon">🔒</span><div><strong>Locked until you hit ${audShort(goal.targetCents)} or ${fmtDate(goal.deadline)}</strong><br><span class="small">That's the point of forced savings. When you reach the target, we pay it into ${esc(goal.payoutAccount.accountName)} automatically.</span></div></div>
      <details><summary class="small muted" style="cursor:pointer">Need it early?</summary>
        <form id="release-form" style="margin-top:10px">
          <div class="field"><label for="reason">Why do you need it?</label><input id="reason" name="reason" required placeholder="e.g. Unexpected car repairs"></div>
          <p class="hint">Early release has a 7-day cooling-off period, so you have time to sleep on it.</p>
          <div class="row"><button class="btn btn-danger" type="submit">Request early release</button><button class="btn btn-secondary" type="button" id="payout-btn">Withdraw now</button></div>
        </form></details>`;
  } else {
    const why = { target_reached: 'You hit your target!', deadline_passed: 'Your timeline is up.', early_release: 'The cooling-off period is over.' }[lock.reason];
    lockBox = `<div class="lock-box open"><span class="icon">🔓</span><div><strong>${why}</strong><br><span class="small">Pay ${aud(goal.balanceCents)} to ${esc(describeDestination(goal.payoutAccount))}.</span></div></div>
      <button class="btn btn-block" id="payout-btn" ${goal.balanceCents ? '' : 'disabled'}>Pay out ${aud(goal.balanceCents)}</button>`;
  }

  const tab = ui.tab ?? 'bank';
  const addMoney = done ? '' : `
    <section class="card">
      <h2>Add money</h2>
      <div class="tabs" role="tablist">
        ${[['bank', '🏦 From my bank'], ['roundups', '🪙 Round-ups']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="chip-btn ${tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}
      </div>
      ${tab === 'bank' ? `
        <form id="deposit-form" class="row">
          <div class="field" style="margin:0"><label for="dep-amount">Amount</label><div class="money-input"><input id="dep-amount" name="amount" type="number" min="1" step="0.01" required value="${(Math.max(plan.requiredPerPeriodCents.fortnightly, 100) / 100).toFixed(0)}" inputmode="decimal"></div></div>
          <button class="btn" type="submit">Deposit</button>
        </form>
        <p class="hint" id="deposit-fee"></p>
        <p class="hint">Pulled from your linked Everyday Account by PayTo. Payday deposits are on the home screen.</p>`
      : goal.roundups.enabled ? `
        <p class="small muted">Every card purchase is rounded up to the next ${audShort(goal.roundups.multipleCents)} and the spare change goes into this goal.</p>
        <button class="btn btn-secondary" id="shop-btn" type="button">🛍️ Simulate some card purchases</button>
        ${purchases.length ? `<ul class="purchases">${purchases.map((t) => {
          const r = (-t.amountCents) % goal.roundups.multipleCents;
          return `<li><span>${esc(t.description)}</span><span class="num">${aud(-t.amountCents)} <span class="roundup">+${aud(r ? goal.roundups.multipleCents - r : 0)}</span></span></li>`;
        }).join('')}</ul>
        <button class="btn btn-block" id="sweep-btn" type="button">Save ${aud(pendingRoundups)} in round-ups</button>
        <p class="hint">${feeLine(pendingRoundups)}</p>` : ''}`
      : `<p class="muted small">Round-ups are off for this goal.</p><button class="btn btn-secondary" id="enable-roundups" type="button">Turn on round-ups</button>`}
    </section>`;

  return `
  <a class="back" href="#/">← All goals</a>
  <div class="card goal-hero">
    <div>
      <div class="pig-big">${pigSvg(shownPct)}</div>
      <div class="pig-caption"><div class="big-number num">${aud(done ? paidCents : goal.balanceCents)}</div><div class="muted num">${done ? `paid out · ${shownPct}% of ${audShort(goal.targetCents)}` : `of ${audShort(goal.targetCents)} · ${plan.percentComplete}%`}</div></div>
    </div>
    <div>
      <div class="muted small">${CATEGORY[goal.category].icon} ${CATEGORY[goal.category].label}</div>
      <h1>${esc(goal.name)}</h1>
      <div class="chips">${statusChips(goal)}</div>
      ${done ? '' : `
      <p style="margin-top:16px">To reach it by <strong>${fmtDate(goal.deadline)}</strong> (${plan.daysLeft} days), save:</p>
      <div class="plan-grid">
        <div class="plan-cell"><strong>${audShort(plan.requiredPerPeriodCents.weekly)}</strong><span>week</span></div>
        <div class="plan-cell"><strong>${audShort(plan.requiredPerPeriodCents.fortnightly)}</strong><span>fortnight</span></div>
        <div class="plan-cell"><strong>${audShort(plan.requiredPerPeriodCents.monthly)}</strong><span>month</span></div>
      </div>`}
      <div class="milestones">${plan.milestones.map((m) => { const hit = done ? paidCents >= m.amountCents : m.reached; return `<div class="milestone ${hit ? 'reached' : ''}"><div class="dot">${hit ? '✓' : ''}</div>${m.percent}%</div>`; }).join('')}</div>
    </div>
  </div>

  <div class="grid grid-2" style="margin-top:16px">
    <div class="stack">
      ${addMoney}
      <section class="card"><h2>${done ? 'Paid into' : 'Getting your money'}</h2>
        <p class="small"><span class="pill chip-locked">${destIcon(goal.payoutAccount)} ${METHOD[goal.payoutAccount.method ?? 'bank_transfer'].label}</span> ${esc(describeDestination(goal.payoutAccount))}</p>
        ${lockBox}</section>
    </div>
    <div class="stack">
      ${done ? '' : `
      <section class="card">
        <h2>Settings</h2>
        <form id="settings-form">
          <div class="row">
            <div class="field"><label for="s-rem">Reminders</label><select id="s-rem" name="reminders">${['off', 'weekly', 'fortnightly', 'monthly'].map((o) => `<option ${goal.notifications.reminders === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
            <div class="field"><label for="s-st">Statements</label><select id="s-st" name="statements">${['off', 'monthly', 'quarterly'].map((o) => `<option ${goal.notifications.statements === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
          </div>
          <div class="row">
            <div class="field"><label for="s-ch">Send by</label><select id="s-ch" name="channel">${['email', 'sms', 'push'].map((o) => `<option ${goal.notifications.channel === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
            <div class="field"><label for="s-rt">Round up to</label><select id="s-rt" name="roundTo">${[1, 2, 5, 10].map((o) => `<option value="${o}" ${goal.roundups.multipleCents === o * 100 ? 'selected' : ''}>$${o}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label class="check"><input type="checkbox" name="roundups" ${goal.roundups.enabled ? 'checked' : ''}> Round-ups on</label></div>
          <p class="hint">Your target and deadline can't be lowered. That's what keeps it forced savings.</p>
          <button class="btn btn-secondary btn-block" type="submit">Save settings</button>
        </form>
      </section>`}
      <section class="card">
        <h2>Activity</h2>
        ${ledger.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>What</th><th class="amt">Amount</th><th class="amt fee-col">Fee</th></tr></thead>
          <tbody>${ledger.map((e) => `<tr><td>${new Date(e.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</td><td class="desc">${SOURCE_LABEL[e.source] ?? esc(e.source)}<div class="muted small">${esc(e.description)}${e.type === 'deposit' && e.grossCents ? ` · ${aud(e.grossCents)} in, ${aud(e.feeCents)} fee` : ''}</div></td><td class="amt ${e.amountCents >= 0 ? 'pos' : 'neg'}">${e.amountCents >= 0 ? '+' : '−'}${aud(Math.abs(e.amountCents))}</td><td class="amt fee-col">${aud(e.feeCents)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="muted small">Nothing yet. Make your first deposit!</p>'}
      </section>
    </div>
  </div>`;
}

// ------------------------------------------------------------ routing & events

const ui = { tab: 'bank', newGoalPrefill: {} };

function render() {
  document.getElementById('clock-date').textContent = clock().toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  const user = currentUser();
  const hash = location.hash.replace(/^#\/?/, '');
  const [route, id] = hash.split('/');

  if (!user) {
    $app.innerHTML = viewWelcome();
    bindWelcome();
    return;
  }
  if (route === 'new') {
    $app.innerHTML = viewNewGoal(user, ui.newGoalPrefill);
    bindNewGoal(user);
  } else if (route === 'goal' && store.getGoal(id)) {
    $app.innerHTML = viewGoal(id, ui);
    bindGoal(id);
  } else {
    $app.innerHTML = viewDashboard(user);
    bindDashboard(user);
  }
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
  window.scrollTo({ top: 0 });
}

function bindWelcome() {
  document.getElementById('signup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = formData(e.target);
    run(() => service.createUser({ ...f, lastName: 'Demo' }), 'Welcome to Oinkster! 🐷').then((u) => u && go('#/new'));
  });
  document.getElementById('sample-btn').addEventListener('click', () => run(loadSample, 'Sample account loaded').then(() => go('#/')));
}

async function loadSample() {
  const user = await service.createUser({ firstName: 'Andrew', lastName: 'Demo', email: 'andrew@example.com' });
  const card = service.createGoal(user.id, {
    name: 'Clear the credit card', category: 'credit_card', targetAmount: 5000, timelineMonths: 6,
    payoutAccount: { method: 'bpay', accountName: 'My Visa', billerCode: '24281', crn: '4564001234567890' },
    payrollAllocationPercent: 60, roundups: { enabled: true },
    notifications: { reminders: 'fortnightly', statements: 'monthly', channel: 'push' },
  });
  service.createGoal(user.id, {
    name: 'Trip to Japan', category: 'holiday', targetAmount: 6000, timelineMonths: 10,
    payoutAccount: { accountName: 'Travel account', bsb: '063-000', accountNumber: '11223344' },
    payrollAllocationPercent: 40, notifications: { reminders: 'monthly', statements: 'quarterly', channel: 'email' },
  });
  await service.deposit(card.id, { amount: 750 });
  await service.receiveIncomingPayment({ reference: user.payrollReference, amount: 600, payerName: 'Acme Pty Ltd' });
  return user;
}

function bindFeePreview(inputId, hintId) {
  const input = document.getElementById(inputId);
  const hint = document.getElementById(hintId);
  if (!input || !hint) return;
  const update = () => { hint.textContent = feeLine(Math.round((Number(input.value) || 0) * 100)); };
  input.addEventListener('input', update);
  update();
}

function bindDashboard(user) {
  bindFeePreview('payday-amount', 'payday-fee');
  document.getElementById('payday-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = Number(formData(e.target).amount);
    run(() => service.receiveIncomingPayment({ reference: user.payrollReference, amount, payerName: 'Acme Pty Ltd' }),
      (r) => `💸 Payday! ${aud(Math.round(amount * 100))} (${aud(r.entries.reduce((t, x) => t + x.feeCents, 0))} fee) split across ${r.entries.length} goal${r.entries.length === 1 ? '' : 's'}${r.payouts.length ? '. A goal was completed and paid out 🎉' : ''}`);
  });
}

function bindNewGoal(user) {
  const form = document.getElementById('goal-form');
  const months = document.getElementById('g-months');
  const target = document.getElementById('g-target');
  const updateHint = () => {
    const m = Number(months.value);
    const t = Math.round(Number(target.value) * 100) || 0;
    document.getElementById('months-out').textContent = `${m} month${m === 1 ? '' : 's'}`;
    document.getElementById('plan-hint').textContent = t > 0 ? `That's about ${aud(Math.ceil(t / m))} a month, or ${aud(Math.ceil(t / Math.ceil((m * 365.25) / 12 / 14)))} a fortnight.` : '';
  };
  const syncMethod = () => {
    const chosen = form.querySelector('input[name="method"]:checked').value;
    form.querySelectorAll('[data-method]').forEach((el) => {
      el.hidden = el.dataset.method !== chosen;
      el.querySelectorAll('input, select').forEach((i) => { i.disabled = el.hidden; });
    });
    form.querySelector('label[for="p-name"]').textContent = chosen === 'bank_transfer' ? 'Account name' : 'Biller or payee name';
  };
  form.querySelectorAll('input[name="method"]').forEach((r) => r.addEventListener('change', syncMethod));
  syncMethod();
  months.addEventListener('input', updateHint);
  target.addEventListener('input', updateHint);
  updateHint();

  document.querySelectorAll('[data-idea]').forEach((b) => b.addEventListener('click', () => {
    const idea = GOAL_IDEAS[Number(b.dataset.idea)];
    ui.newGoalPrefill = { name: idea.name, category: idea.category, target: Number(target.value) || 5000, months: Number(months.value) };
    render();
    toast(idea.description);
  }));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = formData(form);
    run(() => service.createGoal(user.id, {
      name: f.name,
      category: f.category,
      targetAmount: Number(f.targetAmount),
      timelineMonths: Number(f.timelineMonths),
      payoutAccount: f.method === 'bpay'
        ? { method: 'bpay', accountName: f.accountName, billerCode: f.billerCode, crn: f.crn }
        : f.method === 'payto'
          ? { method: 'payto', accountName: f.accountName, payIdType: f.payIdType, payId: f.payId, reference: f.payRef || undefined }
          : { method: 'bank_transfer', accountName: f.accountName, bsb: f.bsb, accountNumber: f.accountNumber, reference: f.reference || undefined },
      payrollAllocationPercent: Number(f.payrollAllocationPercent) || 0,
      roundups: { enabled: f.roundups === 'on' },
      notifications: { reminders: f.reminders, statements: f.statements, channel: f.channel },
    }), 'Goal locked in 🔒').then((g) => {
      if (g) { ui.newGoalPrefill = {}; go(`#/goal/${g.id}`); }
    });
  });
}

const MERCHANTS = [['Flat white, Bean There', 4.8], ['Woolworths', 63.45], ['Uber', 17.3], ['Petrol, Ampol', 71.12], ['Bunnings', 38.9], ['Lunch, Sushi Hub', 13.6], ['Kmart', 22.5], ['Chemist Warehouse', 15.99], ['Netflix', 18.99]];

function bindGoal(goalId) {
  const goal = service.getGoal(goalId);
  const user = service.getUser(goal.userId);

  bindFeePreview('dep-amount', 'deposit-fee');
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; render(); }));

  document.getElementById('deposit-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    run(() => service.deposit(goalId, { amount: Number(formData(e.target).amount) }),
      (r) => (r.payout ? `🎉 Target reached! Paid out to ${goal.payoutAccount.accountName}.` : `Deposited ${aud(r.entry.amountCents)} 🐷 (after ${aud(r.entry.feeCents)} fee)`));
  });

  document.getElementById('shop-btn')?.addEventListener('click', () => {
    const picks = [...MERCHANTS].sort(() => Math.random() - 0.5).slice(0, 3);
    const at = new Date(clock().getTime() + 1).toISOString();
    bank.seedTransactions(user.providerUserId, picks.map(([description, amount]) => ({ description, amountCents: -Math.round(amount * 100), postDate: at })));
    saveBank();
    render();
  });

  document.getElementById('sweep-btn')?.addEventListener('click', () => run(() => service.sweepRoundups(goalId),
    (r) => (r.payout ? '🎉 Round-ups tipped you over the line. Goal paid out!' : `🪙 Saved ${aud(r.entry?.amountCents ?? 0)} in spare change`)));

  document.getElementById('enable-roundups')?.addEventListener('click', () => run(() => service.updateGoalSettings(goalId, { roundups: { enabled: true } }), 'Round-ups on 🪙'));

  document.getElementById('release-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    run(() => service.requestEarlyRelease(goalId, formData(e.target)), 'Request received. Your 7-day cooling-off starts now.');
  });
  document.getElementById('cancel-release')?.addEventListener('click', () => run(() => service.cancelEarlyRelease(goalId), 'Good call. Your goal is locked again 🔒'));
  document.getElementById('payout-btn')?.addEventListener('click', () => run(() => service.payout(goalId), (r) => `💸 ${aud(-r.entry.amountCents)} is on its way to ${goal.payoutAccount.accountName}${goal.payoutAccount.method === 'bpay' ? ' by BPAY' : goal.payoutAccount.method === 'payto' ? ' by PayTo' : ''}`));

  document.getElementById('settings-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = formData(e.target);
    run(() => service.updateGoalSettings(goalId, {
      notifications: { reminders: f.reminders, statements: f.statements, channel: f.channel },
      roundups: { enabled: f.roundups === 'on', roundTo: Number(f.roundTo) },
    }), 'Settings saved');
  });
}

document.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', async () => {
  const days = Number(b.dataset.jump);
  offsetMs += days * DAY_MS;
  save(KEYS.offset, offsetMs);
  const sent = await service.runScheduledNotifications();
  toast(`⏩ Jumped ahead ${days === 1 ? 'a day' : days === 7 ? 'a week' : 'a month'}${sent.length ? `. ${sent.length} new message${sent.length === 1 ? '' : 's'} in your inbox` : ''}`);
  render();
}));

document.getElementById('reset-btn').addEventListener('click', () => {
  if (!confirm('Reset the demo? This clears all goals and savings on this device.')) return;
  for (const k of Object.values(KEYS)) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
  location.hash = '';
  location.reload();
});

window.addEventListener('hashchange', render);
render();
