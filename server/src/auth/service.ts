import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AgentRole } from '../agent/types';

type AuthServiceOptions = {
  jwtSecret?: string;
  jwtExpiresIn?: string;
};

export type TokenPayload = {
  userId: string;
  displayName?: string;
  roles: AgentRole[];
  /** 新 RBAC 系统角色 ID 列表（role-sales 等），可选，旧 token 不包含 */
  roleIds?: string[];
  permissions: string[];
  departmentIds: string[];
};

export function createAuthService(options: AuthServiceOptions = {}) {
  const jwtSecret = options.jwtSecret || process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
  const jwtExpiresIn = options.jwtExpiresIn || '7d';

  async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  function signToken(payload: TokenPayload): string {
    return jwt.sign(payload as object, jwtSecret, { expiresIn: jwtExpiresIn as any });
  }

  function verifyToken(token: string): TokenPayload {
    const decoded = jwt.verify(token, jwtSecret) as TokenPayload;
    return decoded;
  }

  function refreshToken(token: string): string {
    const decoded = jwt.verify(token, jwtSecret, { ignoreExpiration: false }) as TokenPayload;
    const { exp, iat, ...payload } = decoded as TokenPayload & { exp?: number; iat?: number };
    return signToken(payload);
  }

  return { hashPassword, verifyPassword, signToken, verifyToken, refreshToken };
}
