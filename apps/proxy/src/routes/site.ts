import { pipeline } from 'node:stream/promises';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import { deploymentObjectKey, type ObjectStore, type StoredObject } from '@osd/storage';
import { BadPathError, cacheControlFor, isSpaRoute, objectPathFor } from '../lib/path.js';
import type { DeploymentResolver } from '../services/resolver.js';
import { NOT_FOUND_PAGE, PAGE_NOT_FOUND_PAGE, PENDING_PAGE } from './pages.js';

export interface SiteHandlerDeps {
  resolver: DeploymentResolver;
  store: ObjectStore;
  logger: Logger;
}

function sendPage(res: Response, status: number, html: string) {
  res.status(status).type('html').setHeader('Cache-Control', 'no-store').send(html);
}

/** Serves {slug}.{ROOT_DOMAIN}/* from deployments/{currentDeploymentId}/ in storage. */
export function siteHandler(deps: SiteHandlerDeps) {
  return async (req: Request, res: Response, next: NextFunction, slug: string) => {
    res.locals.metricsRoute = 'site';
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      res.status(405).end();
      return;
    }

    try {
      const resolution = await deps.resolver.resolve(slug);
      if (resolution.status === 'unknown') return sendPage(res, 404, NOT_FOUND_PAGE);
      if (resolution.status === 'pending') return sendPage(res, 404, PENDING_PAGE);
      const { deploymentId } = resolution;

      let objectPath: string;
      try {
        objectPath = objectPathFor(req.path);
      } catch (err) {
        if (err instanceof BadPathError) return sendPage(res, 400, PAGE_NOT_FOUND_PAGE);
        throw err;
      }

      const get = (path: string) => deps.store.get(deploymentObjectKey(deploymentId, path));
      let status = 200;
      let servedPath = objectPath;
      let object: StoredObject | null = await get(objectPath);

      if (!object && isSpaRoute(objectPath)) {
        servedPath = 'index.html';
        object = await get(servedPath);
      }
      if (!object) {
        status = 404;
        servedPath = '404.html';
        object = await get(servedPath);
        if (!object) return sendPage(res, 404, PAGE_NOT_FOUND_PAGE);
      }

      res.status(status);
      res.setHeader('Content-Type', object.contentType ?? 'application/octet-stream');
      if (object.contentLength !== undefined) res.setHeader('Content-Length', object.contentLength);
      if (object.etag) res.setHeader('ETag', object.etag);
      res.setHeader('Cache-Control', status === 200 ? cacheControlFor(servedPath) : 'no-cache');

      if (req.method === 'HEAD') {
        object.body.destroy();
        res.end();
        return;
      }
      await pipeline(object.body, res);
    } catch (err) {
      if (res.headersSent) {
        deps.logger.warn({ err }, 'stream to client aborted');
        res.destroy();
        return;
      }
      next(err);
    }
  };
}
