import { createApp } from './app.js';
import { createFileStore } from './fileStore.js';
import { createProvider } from './providers/index.js';
import { Notifier } from './services/notifier.js';
import { SavingsService } from './services/savings.js';

const store = createFileStore(process.env.DATA_FILE);
const provider = createProvider();
const notifier = new Notifier({
  store,
  deliver: async (n) => console.log(`[notify:${n.channel}] ${n.userId}: ${n.message}`),
});
const service = new SavingsService({
  store,
  provider,
  notifier,
  collectionAccount: {
    accountName: process.env.COLLECTION_ACCOUNT_NAME ?? 'Oinkster Savings Trust',
    bsb: process.env.COLLECTION_BSB ?? '000-000',
    accountNumber: process.env.COLLECTION_ACCOUNT_NUMBER ?? '00000000',
  },
});

const port = Number(process.env.PORT ?? 3000);
createApp({ service, store, webhookSecret: process.env.WEBHOOK_SECRET }).listen(port, () => {
  console.log(`Oinkster API on http://localhost:${port} (provider: ${provider.name})`);
});
