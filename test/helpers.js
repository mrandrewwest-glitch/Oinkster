import { createApp } from '../src/app.js';
import { Store } from '../src/store.js';
import { MockProvider } from '../src/providers/mock.js';
import { Notifier } from '../src/services/notifier.js';
import { SavingsService } from '../src/services/savings.js';

export function setup({ now = new Date('2026-01-01T00:00:00Z'), webhookSecret } = {}) {
  const clock = { now };
  const store = new Store();
  const provider = new MockProvider();
  const notifier = new Notifier({ store });
  const service = new SavingsService({
    store,
    provider,
    notifier,
    collectionAccount: { accountName: 'Oinkster Savings Trust', bsb: '123-456', accountNumber: '99999999' },
    clock: () => clock.now,
  });
  const app = createApp({ service, store, webhookSecret });
  return { app, store, provider, service, clock };
}

export const payoutAccount = { accountName: 'Home Loan', bsb: '062-000', accountNumber: '87654321', reference: 'LOAN123' };
