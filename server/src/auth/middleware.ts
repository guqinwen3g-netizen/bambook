import { Request, Response, NextFunction } from 'express';
import { createAuthService, TokenPayload } from './service';
import { AgentRole } from '../agent/types';

type AuthMiddlewareOptions = {
  jwtSecret?: string;
};

const auth = createAuthService();

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const payload = extractActorFromRequest(req);
  if (!payload) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Login required.' });
  }
  (req as any).actor = payload;
  next();
}

export function requireRole(...roles: AgentRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const payload = extractActorFromRequest(req);
    if (!payload) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Login required.' });
    }
    const hasRole = payload.roles.some((role: string) => roles.includes(role as AgentRole));
    if (!hasRole) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Insufficient role.' });
    }
    (req as any).actor = payload;
    next();
  };
}

export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const payload = extractActorFromRequest(req);
  if (payload) {
    (req as any).actor = payload;
  }
  next();
}

export function extractActorFromRequest(req: Request): TokenPayload | null {
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  const token = req.cookies?.bambook_token || bearer;
  if (!token) return null;
  try {
    return auth.verifyToken(token);
  } catch {
    return null;
  }
}
