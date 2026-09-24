# 🐷 Oinkster — forced-savings API

A digital piggy bank for adults. You set a goal, lock the money away until you hit it, and Oinkster pays it
straight into the account you nominate: your mortgage, your credit card, or anywhere else. No fees.

## Clickable demo

`demo/` is a static web app that runs the real savings engine from `src/` in the browser, with a
pretend bank. You don't need a server or API keys. It includes a **time machine** (+1 day, week or
month) so you can show reminders, statements, the cooling-off period and deadlines in seconds.
Each visitor's data stays in their own browser, and **Reset demo** clears it.

```bash
npm run demo   # http://localhost:5173
```

**Deploy on Netlify:** Add new site → Import from GitHub → pick this repo and branch. The
`netlify.toml` already sets the build command (`npm run build:demo`) and publish folder (`demo-dist`).

## Which banking API, and why

Oinkster is built for Australia (BSBs, payroll splits, AUD), so the banking provider has to work with
**Open Banking (the Consumer Data Right)** and the **New Payments Platform (NPP / PayTo)**.

| Requirement | What it needs | Basiq |
|---|---|---|
| Deposit from multiple methods | Pull money from the user's bank (PayTo / direct debit) | ✅ Payments API: payment requests (confirm PayTo is enabled on your account) |
| Money from employer's pay | A collection account + reference employers can pay to | ⚠️ Not Basiq: use your bank partner's collection account (or a Zepto/Monoova PayID/virtual account); its credit notifications call `/webhooks/incoming-payment` |
| Auto round-ups | Read the user's card/bank transactions | ✅ Data API (CDR accredited) |
| Pay goal into house / credit card | Send money to any BSB + account | ✅ Payments API: payouts |
| No fees to users | Fair, per-transaction pricing Oinkster can absorb | ✅ Usage-based pricing, free sandbox |
| Developer-friendly | REST, sandbox, test banks | ✅ REST, sandbox with test institutions |

**Chosen: [Basiq](https://basiq.io)** (Australian, CDR accredited, data + payments in one API).
Alternatives if needed: **Zepto** or **Monoova** (NPP/PayTo payments and virtual accounts, but no transaction data), and
**Frollo** (CDR data). The code keeps the provider behind a small interface
(`src/providers/`), so you can add or swap one without touching the savings logic.

> ⚠️ **Before handling real money:** holding customer funds in Australia means using an ADI/bank
> partner's trust or segregated account and holding (or operating under) an AFSL. The `COLLECTION_*`
> account in `.env` should come from that partner. Take legal and compliance advice before launch.

## Features (all implemented and tested)

- **Goals**: name, category (house, credit card, holiday, emergency fund…), target (e.g. $5,000), and a timeline
  (`timelineMonths: 6`) or an exact `deadline`.
- **Savings plan**: how much to save each week, fortnight or month, whether you're on track, and milestones at 25/50/75/100%.
- **Forced savings lock**: money stays locked until the target is reached or the deadline passes.
  Breaking a goal early needs an **early-release request plus a 7-day cooling-off period**.
- **Payout to a nominated account**: when a goal completes it is paid automatically to the BSB and account
  you set (with a reference, e.g. your loan number).
- **Deposit methods**
  - one-off or top-up deposits pulled from the user's linked bank (PayTo / direct debit)
  - **employer payroll split**: each user gets a unique reference; the employer pays to the collection
    account, and the payment is split across goals by `payrollAllocationPercent`
  - bank transfer to the same account and reference
  - **round-ups** of card purchases (to the nearest $1, or any amount, e.g. $5)
- **Reminders and statements**: weekly, fortnightly or monthly reminders by email, SMS or push; monthly or quarterly statements.
- **No fees**: every ledger entry records `feeCents: 0`, and statements and the dashboard show it.
- **Dashboard**: total saved, per-goal progress and recent activity.

## Run it

```bash
npm install
cp .env.example .env     # BANKING_PROVIDER=mock works with no keys
npm start                # http://localhost:3000
npm test
```

To use real banks, get a Basiq API key from the Basiq dashboard (sandbox is free), then set
`BANKING_PROVIDER=basiq` and `BASIQ_API_KEY=...`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/goal-ideas` | Suggested goals (pay off the house, clear the credit card…) |
| POST | `/users` | Sign up `{email, firstName, lastName, mobile?}` |
| POST | `/users/:id/bank-connection` | Get the Basiq consent URL to link a bank |
| GET | `/users/:id/accounts` | Linked bank accounts |
| GET | `/users/:id/payroll-instructions` | BSB, account and reference to give your employer |
| GET | `/users/:id/dashboard` | Totals, goals, recent activity |
| GET | `/users/:id/notifications` | Reminders and statements sent |
| POST | `/users/:id/goals` | Create a goal (see below) |
| GET | `/users/:id/goals` | List goals, with plan and lock state |
| GET/PATCH | `/goals/:id` | View a goal, or change reminders, round-ups or payout account |
| POST | `/goals/:id/deposits` | `{amount}` pulled from the linked bank |
| POST | `/goals/:id/roundups/sweep` | Save round-ups since the last sweep |
| POST/DELETE | `/goals/:id/early-release` | Request early release `{reason}`, or cancel the request |
| POST | `/goals/:id/payout` | Pay out (only once unlocked) |
| GET | `/goals/:id/statement?from&to` | Statement for a period |
| POST | `/webhooks/incoming-payment` | Bank/provider notifies an incoming payroll or transfer `{reference, amount, source?, payerName?}` (`x-webhook-secret` header) |
| POST | `/jobs/notifications` | Run from a daily cron to send due reminders and statements |

Create a goal:

```json
POST /users/{id}/goals
{
  "name": "Pay off credit card",
  "category": "credit_card",
  "targetAmount": 5000,
  "timelineMonths": 6,
  "payoutAccount": { "accountName": "My Visa", "bsb": "062-000", "accountNumber": "12345678", "reference": "4564..." },
  "payrollAllocationPercent": 50,
  "roundups": { "enabled": true, "roundTo": 1 },
  "notifications": { "reminders": "fortnightly", "statements": "monthly", "channel": "email" }
}
```

Amounts in requests are dollars; responses use integer cents (`targetCents`, `balanceCents`).

## Project layout

```
src/
  app.js                 HTTP routes
  index.js               wiring and config
  store.js               in-memory / JSON-file store (swap for Postgres)
  domain/                pure logic: money, savings plan, round-ups
  services/savings.js    goals, deposits, lock, payouts, statements, reminders
  services/notifier.js   hook in email, SMS or push delivery
  providers/basiq.js     Basiq Open Banking + Payments adapter
  providers/mock.js      local/dev provider
test/                    node:test suite
```

## Next steps before production

1. Authentication (e.g. Auth0 or Cognito); the routes currently trust the IDs in the path.
2. Postgres in place of the JSON store, with a proper double-entry ledger.
3. Map Basiq payment webhooks (settled or failed debits) to ledger status, instead of treating debits as instant.
4. Connect real email, SMS and push delivery in `index.js`.
5. Phase 2 and 3 roadmap: smart nudges, shared goals, tips feed, gamified challenges.
