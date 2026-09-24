import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { HttpError, GOAL_IDEAS } from './services/savings.js';

export function createApp({ service, store, webhookSecret }) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true, provider: service.provider.name }));
  app.get('/goal-ideas', (req, res) => res.json(GOAL_IDEAS));

  // Users & bank connection
  app.post('/users', async (req, res) => res.status(201).json(await service.createUser(req.body ?? {})));
  app.get('/users/:userId', (req, res) => res.json(service.getUser(req.params.userId)));
  app.post('/users/:userId/bank-connection', async (req, res) => res.json(await service.bankConnectUrl(req.params.userId)));
  app.get('/users/:userId/accounts', async (req, res) => res.json(await service.linkedAccounts(req.params.userId)));
  app.get('/users/:userId/payroll-instructions', (req, res) => res.json(service.payrollInstructions(req.params.userId)));
  app.get('/users/:userId/dashboard', (req, res) => res.json(service.dashboard(req.params.userId)));
  app.get('/users/:userId/notifications', (req, res) => {
    service.getUser(req.params.userId);
    res.json(store.notificationsForUser(req.params.userId));
  });

  // Goals
  app.post('/users/:userId/goals', (req, res) => {
    const goal = service.createGoal(req.params.userId, req.body ?? {});
    res.status(201).json(service.goalView(goal));
  });
  app.get('/users/:userId/goals', (req, res) => {
    service.getUser(req.params.userId);
    res.json(store.goalsForUser(req.params.userId).map((g) => service.goalView(g)));
  });
  app.get('/goals/:goalId', (req, res) => res.json(service.goalView(service.getGoal(req.params.goalId))));
  app.patch('/goals/:goalId', (req, res) => res.json(service.goalView(service.updateGoalSettings(req.params.goalId, req.body ?? {}))));
  app.post('/goals/:goalId/deposits', async (req, res) => res.status(201).json(await service.deposit(req.params.goalId, req.body ?? {})));
  app.post('/goals/:goalId/roundups/sweep', async (req, res) => res.json(await service.sweepRoundups(req.params.goalId)));
  app.post('/goals/:goalId/early-release', (req, res) => res.status(202).json(service.requestEarlyRelease(req.params.goalId, req.body ?? {})));
  app.delete('/goals/:goalId/early-release', (req, res) => res.json(service.cancelEarlyRelease(req.params.goalId)));
  app.post('/goals/:goalId/payout', async (req, res) => res.json(await service.payout(req.params.goalId)));
  app.get('/goals/:goalId/statement', (req, res) => res.json(service.statement(req.params.goalId, req.query)));

  // Inbound money (employer payroll split, bank transfers). Called by the bank/provider.
  app.post('/webhooks/incoming-payment', async (req, res) => {
    if (webhookSecret) {
      const given = Buffer.from(req.get('x-webhook-secret') ?? '');
      const expected = Buffer.from(webhookSecret);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        throw new HttpError(401, 'Invalid webhook secret');
      }
    }
    res.status(201).json(await service.receiveIncomingPayment(req.body ?? {}));
  });

  // Trigger from a daily cron job.
  app.post('/jobs/notifications', async (req, res) => res.json({ sent: await service.runScheduledNotifications() }));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    // 502s come from the banking provider and are safe to surface; other 5xx are not.
    const expose = status < 500 || status === 502 || err instanceof HttpError;
    res.status(status).json({ error: expose ? err.message : 'Internal error', details: err.details });
  });
  return app;
}
