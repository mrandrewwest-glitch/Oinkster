/**
 * Minimal store: in-memory collections with a pluggable `persist` hook
 * (a JSON file on the server, localStorage in the browser demo).
 * Swap for Postgres before production. The service only uses the methods below.
 */
export function emptyData() {
  return { users: {}, goals: {}, ledger: [], notifications: [] };
}

export class Store {
  constructor({ data, persist } = {}) {
    this.data = data ?? emptyData();
    this.persist = persist ?? (() => {});
  }

  save() { this.persist(this.data); }

  getUser(id) { return this.data.users[id] ?? null; }
  allUsers() { return Object.values(this.data.users); }
  findUserByPayrollReference(ref) {
    return Object.values(this.data.users).find((u) => u.payrollReference === ref) ?? null;
  }
  putUser(user) { this.data.users[user.id] = user; this.save(); return user; }

  getGoal(id) { return this.data.goals[id] ?? null; }
  goalsForUser(userId) {
    return Object.values(this.data.goals)
      .filter((g) => g.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  allGoals() { return Object.values(this.data.goals); }
  putGoal(goal) { this.data.goals[goal.id] = goal; this.save(); return goal; }

  addLedgerEntry(entry) { this.data.ledger.push(entry); this.save(); return entry; }
  ledgerForGoal(goalId) { return this.data.ledger.filter((e) => e.goalId === goalId); }

  addNotification(n) { this.data.notifications.push(n); this.save(); return n; }
  notificationsForUser(userId) { return this.data.notifications.filter((n) => n.userId === userId); }
}
