import { describe, expect, it } from 'vitest';
import { createAuthService } from '../service';

const JWT_SECRET = 'test-secret-key-at-least-32-chars';

describe('Auth service', () => {
  it('hashes and verifies passwords with bcrypt', async () => {
    const auth = createAuthService({ jwtSecret: JWT_SECRET });
    const hash = await auth.hashPassword('my-secure-password');
    expect(hash).not.toBe('my-secure-password');
    await expect(auth.verifyPassword('my-secure-password', hash)).resolves.toBe(true);
    await expect(auth.verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('signs a JWT and verifies it back to an ActorContext', async () => {
    const auth = createAuthService({ jwtSecret: JWT_SECRET });
    const token = auth.signToken({
      userId: 'u1',
      displayName: 'Kevin',
      roles: ['owner'],
      permissions: ['ai:chat', 'orders:read'],
      departmentIds: ['company'],
    });
    expect(typeof token).toBe('string');

    const payload = auth.verifyToken(token);
    expect(payload).toMatchObject({
      userId: 'u1',
      displayName: 'Kevin',
      roles: ['owner'],
      permissions: ['ai:chat', 'orders:read'],
      departmentIds: ['company'],
    });
  });

  it('rejects an invalid or expired token', () => {
    const auth = createAuthService({ jwtSecret: JWT_SECRET });
    expect(() => auth.verifyToken('garbage-token')).toThrow();
  });

  it('refreshes a valid token and returns a new one', () => {
    const auth = createAuthService({ jwtSecret: JWT_SECRET });
    const original = auth.signToken({
      userId: 'u1',
      displayName: 'Finance',
      roles: ['finance'],
      permissions: ['finance:read'],
      departmentIds: ['finance'],
    });
    const refreshed = auth.refreshToken(original);
    const payload = auth.verifyToken(refreshed);
    expect(payload.userId).toBe('u1');
    expect(payload.roles).toEqual(['finance']);
    expect(payload.permissions).toEqual(['finance:read']);
    expect(payload.departmentIds).toEqual(['finance']);
  });
});
