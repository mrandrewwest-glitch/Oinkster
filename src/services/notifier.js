/**
 * Records notifications and hands them to a delivery function.
 * Plug an email/SMS/push service (e.g. SendGrid, Twilio, Expo) into `deliver`.
 */
export class Notifier {
  constructor({ store, deliver = async () => {}, clock = () => new Date() }) {
    this.store = store;
    this.now = clock;
    this.deliver = deliver;
  }

  async send({ userId, channel, kind, goalId, message, attachment }) {
    const n = { id: crypto.randomUUID(), userId, channel, kind, goalId, message, attachment, sentAt: this.now().toISOString() };
    await this.deliver(n);
    return this.store.addNotification(n);
  }
}
