import { Request, Response, NextFunction } from 'express';
import { extractActorFromRequest } from './middleware';
import type { TokenPayload } from './service';

export interface ModuleAuthGuardOptions {
  requireAuth: boolean;
  apiKeys: Set<string>;
  /**
   * Optional strict principal mapping: when provided, an API key alone is a transport
   * credential, not an identity — it must be bound to an explicit service principal
   * (TokenPayload) or the request is rejected with AGENT_PRINCIPAL_REQUIRED.
   * Use for Agent execution surfaces (e.g. ai module) where least-privilege identity
   * is required. When omitted, any valid API key is accepted (legacy module behavior).
   */
  apiKeyActors?: ReadonlyMap<string, TokenPayload>;
  /**
   * Optional development actor factory: when requireAuth=false, called to build an
   * explicit development principal instead of a bare pass-through. Used by Agent
   * execution surfaces so the identity service never invents owner access implicitly.
   * When omitted and requireAuth=false, the request passes through with any
   * extractable actor attached (legacy behavior).
   */
  devActorFactory?: (req: Request) => TokenPayload;
}

/**
 * Shared module-level auth guard: JWT cookie/Bearer OR API-key header.
 * When requireAuth=false (dev mode), bypasses both checks (or builds a dev actor
 * via devActorFactory when provided).
 * Sets req.actor for downstream audit logging.
 */
export function createModuleAuthGuard(opts: ModuleAuthGuardOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!opts.requireAuth) {
      // Even in dev mode, a real JWT principal always wins over a synthesized dev actor
      // (prevents spoofed body roles from overriding an authenticated session).
      const actor = extractActorFromRequest(req);
      if (actor) {
        (req as any).actor = actor;
        (req as any).authSource = 'user-session';
        return next();
      }
      if (opts.devActorFactory) {
        (req as any).actor = opts.devActorFactory(req);
        (req as any).authSource = 'dev';
        return next();
      }
      return next();
    }

    // Priority 1: JWT (cookie or Bearer)
    const actor = extractActorFromRequest(req);
    if (actor) {
      (req as any).actor = actor;
      (req as any).authSource = 'user-session';
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

    // Strict principal mode: API key must be bound to an explicit service principal.
    if (opts.apiKeyActors) {
      const apiKeyActor = opts.apiKeyActors.get(apiKey);
      if (!apiKeyActor) {
        return res.status(403).json({
          error: 'AGENT_PRINCIPAL_REQUIRED',
          message: 'This API key is not mapped to an Agent service principal.',
        });
      }
      (req as any).actor = apiKeyActor;
      (req as any).authSource = 'api-key';
      return next();
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
