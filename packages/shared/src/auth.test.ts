import { describe, expect, it } from 'vitest';
import {
  InviteStaffRequestSchema,
  PasswordSchema,
  RegisterRequestSchema,
  UpdateStaffRequestSchema,
} from './auth.js';

describe('auth schemas', () => {
  it('should normalise email case and whitespace when registering', () => {
    const parsed = RegisterRequestSchema.parse({
      fullName: 'Amina Hassan',
      email: '  Amina@Example.COM ',
      phone: '+252 61 234 5678',
      password: 'correct horse battery',
    });
    expect(parsed.email).toBe('amina@example.com');
  });

  it('should reject unknown fields when registering', () => {
    const r = RegisterRequestSchema.safeParse({
      fullName: 'Amina Hassan',
      email: 'a@example.com',
      phone: '+252612345678',
      password: 'correct horse battery',
      role: 'ADMIN',
    });
    expect(r.success).toBe(false);
  });

  it('should reject passwords shorter than 10 characters', () => {
    expect(PasswordSchema.safeParse('short1234').success).toBe(false);
    expect(PasswordSchema.safeParse('long enough!').success).toBe(true);
  });

  it.each([
    [{ role: 'OFFICER', departmentCode: 'POLICE' }, true],
    [{ role: 'SUPERVISOR' }, false],
    [{ role: 'ADMIN' }, true],
    [{ role: 'ADMIN', departmentCode: 'POLICE' }, false],
  ])('should enforce the department rule for %o', (input, ok) => {
    const base = { email: 's@example.com', fullName: 'Staff Member' };
    expect(InviteStaffRequestSchema.safeParse({ ...base, ...input }).success).toBe(ok);
    expect(UpdateStaffRequestSchema.safeParse(input).success).toBe(ok);
  });
});
