/**
 * In-memory banking provider for local development and tests.
 * Mirrors the BasiqProvider interface so the rest of the app can't tell them apart.
 */
export class MockProvider {
  name = 'mock';

  constructor() {
    this.users = new Map();
    this.transactions = new Map(); // providerUserId -> transactions
    this.debits = [];
    this.payouts = [];
  }

  async createUser({ email, mobile, firstName, lastName }) {
    const id = `mock-user-${crypto.randomUUID()}`;
    this.users.set(id, { id, email, mobile, firstName, lastName });
    this.transactions.set(id, []);
    return { providerUserId: id };
  }

  async getConsentUrl(providerUserId) {
    return `https://mock.oinkster.local/consent?user=${encodeURIComponent(providerUserId)}`;
  }

  async listAccounts(providerUserId) {
    return [{ id: `${providerUserId}-acc-1`, name: 'Everyday Account', bsb: '062-000', accountNumber: '12345678' }];
  }

  /** Test helper: add card purchases so round-ups have something to work with. */
  seedTransactions(providerUserId, txs) {
    const list = this.transactions.get(providerUserId) ?? [];
    list.push(...txs.map((t) => ({ id: t.id ?? crypto.randomUUID(), postDate: t.postDate ?? new Date().toISOString(), ...t })));
    this.transactions.set(providerUserId, list);
  }

  async listTransactions(providerUserId, { since } = {}) {
    const list = this.transactions.get(providerUserId) ?? [];
    return since ? list.filter((t) => new Date(t.postDate) > new Date(since)) : list;
  }

  async createDebit({ providerUserId, amountCents, description, reference }) {
    const debit = { id: `mock-debit-${crypto.randomUUID()}`, providerUserId, amountCents, description, reference, status: 'settled' };
    this.debits.push(debit);
    return { providerPaymentId: debit.id, status: debit.status };
  }

  async createPayout({ amountCents, to, description, reference }) {
    const payout = { id: `mock-payout-${crypto.randomUUID()}`, amountCents, to, description, reference, status: 'settled' };
    this.payouts.push(payout);
    return { providerPaymentId: payout.id, status: payout.status };
  }
}
