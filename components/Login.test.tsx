import { describe, expect, it } from 'vitest';
import { isAllowedLoginIdentifier } from './Login';

describe('Login identifier validation', () => {
  it('allows normal email login and display-name login', () => {
    expect(isAllowedLoginIdentifier('user@example.com')).toBe(true);
    expect(isAllowedLoginIdentifier(' kevin ')).toBe(true);
    expect(isAllowedLoginIdentifier('KEVIN')).toBe(true);
    expect(isAllowedLoginIdentifier('张三')).toBe(true);
    expect(isAllowedLoginIdentifier('Amy Jiang')).toBe(true);
  });

  it('blocks empty or malformed whitespace-only identifiers', () => {
    expect(isAllowedLoginIdentifier('')).toBe(false);
    expect(isAllowedLoginIdentifier('   ')).toBe(false);
    expect(isAllowedLoginIdentifier('Amy  Jiang')).toBe(false);
  });
});
