import { Request, Response, NextFunction } from 'express';
import { extractActorFromRequest } from './middleware';

export interface ModuleAuthGuardOptions {
  requireAuth: boolean;
  apiKeys: Set<string>;
}

/**
 * Shared module-level auth guard: JWT cookie/Bearer OR API-key header.
 * When requireAuth=false (dev mode), bypasses both checks.
 * Sets req.actor for downstream audit logging.
 */
export function createModuleAuthGuard(opts: ModuleAuthGuardOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!opts.requireAuth) {
      const actor = extractActorFromRequest(req);
      if (actor) (req as any).actor = actor;
      return next();
    }

    // Priority 1: JWT (cookie or Bearer)
    const actor = extractActorFromRequest(req);
    if (actor) {
      (req as any).actor = actor;
      return next();
    }

    // Priority 2: API key
    const apiKey = (req.headers['x-bambook-api-key'] || req.query.apiKey) as string | undefined;
    if (!apiKey) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Login (JWT) or X-Bambook-API-Key required.' });
    }
    if (!opts.apiKeys.has(apiKey)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid API key.' });
    }
    next();
  };
}

/**
 * Write-method-only guard: JWT requireAuth for POST/PATCH/PUT/DELETE.
 * API-key alone is insufficient for write operations.
 * Use as: router.post('/', requireAuthForWrites(opts), handler)
 */
export function requireJwtForWrite(opts: ModuleAuthGuardOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!opts.requireAuth) return next();

    const actor = extractActorFromRequest(req);
    if (actor) {
      (req as any).actor = actor;
      return next();
    }

    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Write operations require JWT login (API key insufficient).' });
  };
}
