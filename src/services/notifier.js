import { randomUUID } from 'node:crypto';

/**
 * Records notifications and hands them to a delivery function.
 * Plug an email/SMS/push service (e.g. SendGrid, Twilio, Expo) into `deliver`.
 */
export class Notifier {
  constructor({ store, deliver = async () => {} }) {
    this.store = store;
    this.deliver = deliver;
  }

  async send({ userId, channel, kind, goalId, message, attachment }) {
    const n = { id: randomUUID(), userId, channel, kind, goalId, message, attachment, sentAt: new Date().toISOString() };
    await this.deliver(n);
    return this.store.addNotification(n);
  }
}
