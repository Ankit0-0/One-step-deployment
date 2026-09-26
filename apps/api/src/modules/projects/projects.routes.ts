import { Router } from 'express';
import {
  createProjectBodySchema,
  idParamsSchema,
  rollbackBodySchema,
  updateProjectBodySchema,
} from '@osd/shared';
import { parse } from '../../lib/validate.js';
import { currentUserId } from '../../middleware/auth.js';
import type { DeploymentsService } from '../deployments/deployments.service.js';
import type { ProjectsService } from './projects.service.js';

/** Mounted behind requireAuth. */
export function projectRoutes(deps: {
  projects: ProjectsService;
  deployments: DeploymentsService;
}): Router {
  const router = Router();
  const { projects, deployments } = deps;

  router.get('/', async (_req, res) => {
    const list = await projects.list(currentUserId(res));
    res.json({ projects: list.map((p) => projects.toDto(p)) });
  });

  router.post('/', async (req, res) => {
    const body = parse(createProjectBodySchema, req.body);
    const project = await projects.create(currentUserId(res), body);
    res.status(201).json({ project: projects.toDto(project) });
  });

  router.get('/:id', async (req, res) => {
    const { id } = parse(idParamsSchema, req.params);
    res.json({ project: projects.toDto(await projects.getOwned(currentUserId(res), id)) });
  });

  router.patch('/:id', async (req, res) => {
    const { id } = parse(idParamsSchema, req.params);
    const body = parse(updateProjectBodySchema, req.body);
    res.json({ project: projects.toDto(await projects.update(currentUserId(res), id, body)) });
  });

  router.get('/:id/deployments', async (req, res) => {
    const { id } = parse(idParamsSchema, req.params);
    res.json({ deployments: await deployments.listForProject(currentUserId(res), id) });
  });

  router.post('/:id/deployments', async (req, res) => {
    const { id } = parse(idParamsSchema, req.params);
    const requestId =
      typeof req.id === 'string' ? req.id : String(res.getHeader('X-Request-Id') ?? '');
    const deployment = await deployments.create(currentUserId(res), id, requestId);
    res.status(201).json({ deployment });
  });

  router.post('/:id/rollback', async (req, res) => {
    const { id } = parse(idParamsSchema, req.params);
    const { deploymentId } = parse(rollbackBodySchema, req.body);
    const project = await deployments.rollback(currentUserId(res), id, deploymentId);
    res.json({ project: projects.toDto(project) });
  });

  return router;
}
