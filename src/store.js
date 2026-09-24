import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Minimal store: in-memory collections, optionally snapshotted to a JSON file.
 * Swap for Postgres before production. The service only uses the methods below.
 */
export class Store {
  constructor({ file } = {}) {
    this.file = file;
    this.data = { users: {}, goals: {}, ledger: [], notifications: [] };
    if (file && existsSync(file)) this.data = JSON.parse(readFileSync(file, 'utf8'));
  }

  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  getUser(id) { return this.data.users[id] ?? null; }
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
