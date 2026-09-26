import { Router } from 'express';
import { idParamsSchema, logsQuerySchema } from '@osd/shared';
import { parse } from '../../lib/validate.js';
import { currentUserId } from '../../middleware/auth.js';
import type { DeploymentsService } from './deployments.service.js';

/** Mounted behind requireAuth. */
export function deploymentRoutes(deps: { deployments: DeploymentsService }): Router {
  const router = Router();

  router.get('/:id', async (req, res) => {
    const { id } = parse(idParamsSchema, req.params);
    res.json({ deployment: await deps.deployments.get(currentUserId(res), id) });
  });

  router.get('/:id/logs', async (req, res) => {
    const { id } = parse(idParamsSchema, req.params);
    const query = parse(logsQuerySchema, req.query);
    res.json({ logs: await deps.deployments.logs(currentUserId(res), id, query) });
  });

  router.post('/:id/cancel', async (req, res) => {
    const { id } = parse(idParamsSchema, req.params);
    res.json({ deployment: await deps.deployments.cancel(currentUserId(res), id) });
  });

  return router;
}
