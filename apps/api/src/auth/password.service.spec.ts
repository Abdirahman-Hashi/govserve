import { UnprocessableEntityException } from '@nestjs/common';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('should reject a password from the common-password list', () => {
    expect(() => service.assertAcceptable('1234567890')).toThrow(UnprocessableEntityException);
  });

  it('should reject a password that contains the email local part', () => {
    expect(() =>
      service.assertAcceptable('amina.hassan2026', { email: 'amina.hassan@example.com' }),
    ).toThrow(UnprocessableEntityException);
  });

  it('should reject a single repeated character', () => {
    expect(() => service.assertAcceptable('aaaaaaaaaaaa')).toThrow(UnprocessableEntityException);
  });

  it('should accept a long uncommon passphrase', () => {
    expect(() =>
      service.assertAcceptable('mango river lantern 42', { email: 'amina@example.com' }),
    ).not.toThrow();
  });

  it('should verify the right password and reject the wrong one when hashed with argon2id', async () => {
    const hash = await service.hash('mango river lantern 42');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(service.verify(hash, 'mango river lantern 42')).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong password here')).resolves.toBe(false);
  });

  it('should return false when there is no stored hash', async () => {
    await expect(service.verify(null, 'anything at all')).resolves.toBe(false);
  });
});
