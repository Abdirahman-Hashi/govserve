import { randomBytes } from 'node:crypto';
import { type AppConfig } from '../config/config.module';
import { CryptoService } from './crypto.service';

const k1 = { id: 'k1', key: randomBytes(32) };
const k2 = { id: 'k2', key: randomBytes(32) };
const blind = randomBytes(32);

function service(keys = [k1]): CryptoService {
  return new CryptoService({ PII_KEYS: keys, BLIND_INDEX_KEY: blind } as unknown as AppConfig);
}

describe('CryptoService', () => {
  it('should round-trip plaintext when encrypting and decrypting', () => {
    const crypto = service();
    expect(crypto.decrypt(crypto.encrypt('SO-1234567'))).toBe('SO-1234567');
  });

  it('should produce different ciphertexts when encrypting the same value twice', () => {
    const crypto = service();
    expect(Buffer.from(crypto.encrypt('x')).equals(Buffer.from(crypto.encrypt('x')))).toBe(false);
  });

  it('should throw when the ciphertext has been tampered with', () => {
    const crypto = service();
    const env = crypto.encrypt('SO-1234567');
    const last = env.length - 1;
    env[last] = env[last]! ^ 0xff;
    expect(() => crypto.decrypt(env)).toThrow();
  });

  it('should throw when the key ID in the header is swapped', () => {
    const crypto = service([k1, k2]);
    const env = Buffer.from(crypto.encrypt('secret'));
    env.write('k2', 2, 'utf8');
    expect(() => crypto.decrypt(env)).toThrow();
  });

  it('should decrypt old rows with a retired key when keys are rotated', () => {
    const old = service([k1]).encrypt('legacy');
    const rotated = service([k2, k1]);
    expect(rotated.decrypt(old)).toBe('legacy');
    expect(Buffer.from(rotated.encrypt('new')).subarray(2, 4).toString()).toBe('k2');
  });

  it('should give the same blind index for normalised equivalents', () => {
    const crypto = service();
    expect(crypto.blindIndex('phone', '+252 61 234-5678')).toBe(
      crypto.blindIndex('phone', '+252612345678'),
    );
    expect(crypto.blindIndex('nationalId', ' so 123 ')).toBe(
      crypto.blindIndex('nationalId', 'SO123'),
    );
  });

  it('should separate blind indexes by field domain', () => {
    const crypto = service();
    expect(crypto.blindIndex('phone', '123')).not.toBe(crypto.blindIndex('nationalId', '123'));
  });
});
