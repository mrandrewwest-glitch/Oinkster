import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BasiqProvider } from '../src/providers/basiq.js';

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const key = `${init.method} ${new URL(url).pathname}`;
    const body = routes[key];
    if (!body) return new Response(JSON.stringify({ data: [{ detail: 'nope' }] }), { status: 404 });
    return new Response(JSON.stringify(typeof body === 'function' ? body(url, init) : body), { status: 200 });
  };
  return { impl, calls };
}

test('Basiq: authenticates once and maps transactions to cents', async () => {
  const { impl, calls } = fakeFetch({
    'POST /token': { access_token: 'tok', expires_in: 3600 },
    'POST /users': { id: 'basiq-user-1' },
    'GET /users/basiq-user-1/transactions': { data: [{ id: 't1', amount: '-4.50', postDate: '2026-01-02', description: 'Coffee' }], links: {} },
  });
  const basiq = new BasiqProvider({ apiKey: 'key', fetchImpl: impl });
  const { providerUserId } = await basiq.createUser({ email: 'a@b.com', firstName: 'A', lastName: 'B' });
  const txs = await basiq.listTransactions(providerUserId, { since: '2026-01-01T00:00:00Z' });
  assert.deepEqual(txs, [{ id: 't1', description: 'Coffee', amountCents: -450, postDate: '2026-01-02' }]);
  assert.equal(calls.filter((c) => c.url.endsWith('/token')).length, 1);
  assert.equal(calls[0].init.headers.Authorization, 'Basic key');
  assert.match(decodeURIComponent(calls[2].url), /transaction\.postDate\.gt\('2026-01-01'\)/);
});

test('Basiq: surfaces API errors as 502', async () => {
  const { impl } = fakeFetch({ 'POST /token': { access_token: 'tok', expires_in: 3600 } });
  const basiq = new BasiqProvider({ apiKey: 'key', fetchImpl: impl });
  await assert.rejects(basiq.listAccounts('missing'), (err) => err.status === 502 && /nope/.test(err.message));
});

test('Basiq: refuses BPAY payouts rather than sending money to the wrong place', async () => {
  const { impl, calls } = fakeFetch({ 'POST /token': { access_token: 'tok', expires_in: 3600 } });
  const basiq = new BasiqProvider({ apiKey: 'key', fetchImpl: impl });
  await assert.rejects(
    basiq.createPayout({ amountCents: 100, to: { method: 'bpay', billerCode: '24281', crn: '123' }, reference: 'r' }),
    (err) => err.status === 422,
  );
  assert.equal(calls.length, 0);
});
