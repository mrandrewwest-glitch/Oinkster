/**
 * Basiq (https://basiq.io) adapter: Australian Open Banking (CDR) data + Payments.
 *
 * - Data API: connect the customer's bank (via the hosted consent UI) and read
 *   transactions, which is what powers round-ups.
 * - Payments API: pull money from the customer's account into their Oinkster goal
 *   (PayTo / direct debit) and pay a completed goal out to a nominated account
 *   (e.g. a mortgage offset or a credit card).
 *
 * Endpoint paths and payload shapes follow Basiq API v3. Payments must be enabled on
 * your Basiq account; confirm the payment request/payout shapes against the
 * sandbox before going live.
 */
export class BasiqProvider {
  name = 'basiq';

  constructor({ apiKey, baseUrl = 'https://au-api.basiq.io', consentUrl = 'https://consent.basiq.io/home', fetchImpl = fetch } = {}) {
    if (!apiKey) throw new Error('BASIQ_API_KEY is required for the Basiq provider');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.consentUrl = consentUrl;
    this.fetch = fetchImpl;
    this.serverToken = null;
  }

  async #token(scope = 'SERVER_ACCESS', userId) {
    if (scope === 'SERVER_ACCESS' && this.serverToken && this.serverToken.expiresAt > Date.now() + 60_000) {
      return this.serverToken.value;
    }
    const body = new URLSearchParams({ scope });
    if (userId) body.set('userId', userId);
    const res = await this.fetch(`${this.baseUrl}/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'basiq-version': '3.0',
      },
      body,
    });
    const json = await this.#parse(res, 'token');
    if (scope === 'SERVER_ACCESS') {
      this.serverToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    }
    return json.access_token;
  }

  async #request(method, path, body) {
    const token = await this.#token();
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.#parse(res, `${method} ${path}`);
  }

  async #parse(res, label) {
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const detail = json?.data?.[0]?.detail ?? json?.message ?? text;
      const err = new Error(`Basiq ${label} failed (${res.status}): ${detail}`);
      err.status = 502;
      throw err;
    }
    return json;
  }

  async createUser({ email, mobile, firstName, lastName }) {
    const json = await this.#request('POST', '/users', { email, mobile, firstName, lastName });
    return { providerUserId: json.id };
  }

  async getConsentUrl(providerUserId) {
    const clientToken = await this.#token('CLIENT_ACCESS', providerUserId);
    return `${this.consentUrl}?token=${encodeURIComponent(clientToken)}`;
  }

  async listAccounts(providerUserId) {
    const json = await this.#request('GET', `/users/${providerUserId}/accounts`);
    return (json.data ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      bsb: a.bsb,
      accountNumber: a.accountNo,
    }));
  }

  async listTransactions(providerUserId, { since } = {}) {
    const filter = since ? `?filter=${encodeURIComponent(`transaction.postDate.gt('${since.slice(0, 10)}')`)}` : '';
    const out = [];
    let next = `/users/${providerUserId}/transactions${filter}`;
    while (next) {
      const json = await this.#request('GET', next);
      for (const t of json.data ?? []) {
        out.push({
          id: t.id,
          description: t.description,
          // Basiq amounts are signed decimal strings, negative for debits.
          amountCents: Math.round(Number(t.amount) * 100),
          postDate: t.postDate,
        });
      }
      next = json.links?.next ? json.links.next.replace(this.baseUrl, '') : null;
    }
    return out;
  }

  async createDebit({ providerUserId, amountCents, description, reference }) {
    const json = await this.#request('POST', '/payments/payment-requests', {
      requestId: reference,
      description,
      amount: amountCents / 100,
      payer: { payerUserId: providerUserId },
    });
    return { providerPaymentId: json.id, status: json.status ?? 'pending' };
  }

  async createPayout({ amountCents, to, description, reference }) {
    if (to.method && to.method !== 'bank_transfer') {
      // Basiq payouts go to a BSB and account number. BPAY bills and PayTo/PayID
      // need a bill-payment partner (e.g. Zepto, Monoova or Azupay) behind this interface.
      const err = new Error(`${to.method === 'bpay' ? 'BPAY' : 'PayTo'} payouts are not supported by the Basiq provider yet`);
      err.status = 422;
      throw err;
    }
    const json = await this.#request('POST', '/payments/payouts', {
      requestId: reference,
      description,
      amount: amountCents / 100,
      payee: { accountName: to.accountName, bsb: to.bsb, accountNumber: to.accountNumber },
    });
    return { providerPaymentId: json.id, status: json.status ?? 'pending' };
  }
}
