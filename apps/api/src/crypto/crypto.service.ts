import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.module';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Field-level PII encryption (NFR-002): AES-256-GCM with a key ring from the environment.
 * Envelope: [version:1][keyIdLen:1][keyId][iv:12][tag:16][ciphertext]. The keyId lets
 * old rows decrypt after rotation; a KMS-backed key ring can replace PII_KEYS later.
 */
@Injectable()
export class CryptoService {
  private readonly keys: Map<string, Buffer>;
  private readonly activeKeyId: string;
  private readonly blindIndexKey: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const [active] = config.PII_KEYS;
    if (!active) throw new Error('PII_KEYS must contain at least one key');
    this.keys = new Map(config.PII_KEYS.map((k) => [k.id, k.key]));
    this.activeKeyId = active.id;
    this.blindIndexKey = config.BLIND_INDEX_KEY;
  }

  encrypt(plaintext: string): Uint8Array<ArrayBuffer> {
    const key = this.keys.get(this.activeKeyId)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const keyId = Buffer.from(this.activeKeyId, 'utf8');
    // The header is authenticated so a key ID cannot be swapped without detection.
    const header = Buffer.concat([Buffer.from([VERSION, keyId.length]), keyId]);
    cipher.setAAD(header);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return new Uint8Array(Buffer.concat([header, iv, cipher.getAuthTag(), ct]));
  }

  decrypt(envelope: Uint8Array): string {
    const buf = Buffer.from(envelope);
    if (buf[0] !== VERSION) throw new Error('Unsupported ciphertext version');
    const keyIdLen = buf[1]!;
    const headerEnd = 2 + keyIdLen;
    const keyId = buf.subarray(2, headerEnd).toString('utf8');
    const key = this.keys.get(keyId);
    if (!key) throw new Error('Unknown encryption key');
    const iv = buf.subarray(headerEnd, headerEnd + IV_BYTES);
    const tag = buf.subarray(headerEnd + IV_BYTES, headerEnd + IV_BYTES + TAG_BYTES);
    const ct = buf.subarray(headerEnd + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(buf.subarray(0, headerEnd));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  encryptOptional(value: string | null | undefined): Uint8Array<ArrayBuffer> | null {
    return value === null || value === undefined || value === '' ? null : this.encrypt(value);
  }

  decryptOptional(envelope: Uint8Array | null | undefined): string | null {
    return envelope ? this.decrypt(envelope) : null;
  }

  /**
   * Deterministic HMAC for equality search on encrypted fields. `domain` separates
   * fields so the same value in two columns does not produce the same index.
   */
  blindIndex(domain: 'nationalId' | 'phone', value: string): string {
    return createHmac('sha256', this.blindIndexKey)
      .update(`${domain}:${normalise(domain, value)}`)
      .digest('base64url');
  }

  /**
   * Keyed hash for low-entropy secrets such as 6-digit OTPs, so a database leak alone
   * does not allow offline brute force. Compare results with `safeEqual`.
   */
  keyedHash(domain: KeyedHashDomain, value: string): string {
    return createHmac('sha256', this.blindIndexKey)
      .update(`${domain}:${value}`)
      .digest('base64url');
  }

  safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }
}

/** Domains for keyed hashes of short secrets (OTP codes) and device IDs. */
export type KeyedHashDomain = 'otp' | 'device' | 'subject';

function normalise(domain: 'nationalId' | 'phone', value: string): string {
  const trimmed = value.trim().toUpperCase();
  return domain === 'phone' ? trimmed.replace(/[^\d+]/g, '') : trimmed.replace(/\s+/g, '');
}
