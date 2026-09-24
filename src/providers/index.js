import { BasiqProvider } from './basiq.js';
import { MockProvider } from './mock.js';

export function createProvider(env = process.env) {
  const name = env.BANKING_PROVIDER ?? 'mock';
  if (name === 'basiq') {
    return new BasiqProvider({ apiKey: env.BASIQ_API_KEY, baseUrl: env.BASIQ_BASE_URL });
  }
  if (name === 'mock') return new MockProvider();
  throw new Error(`Unknown BANKING_PROVIDER "${name}" (expected "basiq" or "mock")`);
}
