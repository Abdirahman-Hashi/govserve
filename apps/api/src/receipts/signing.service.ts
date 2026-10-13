import { createPrivateKey, createPublicKey, type KeyObject, sign } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { bytesToBase64Url, canonicalize, type PublicKeys } from '@govserve/shared';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';

interface LoadedKey {
  id: string;
  privateKey: KeyObject;
  publicRaw: Buffer;
}

/**
 * Ed25519 signing for receipts and certificates (ADR-0006). Private keys come from the
 * environment/secret store only; their public halves are published and stored in SigningKey
 * so documents signed with a retired key still verify.
 */
@Injectable()
export class SigningService implements OnModuleInit {
  private readonly logger = new Logger(SigningService.name);
  private readonly keys: LoadedKey[];

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    this.keys = config.SIGNING_KEYS.map(({ id, der }) => {
      const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
      if (privateKey.asymmetricKeyType !== 'ed25519')
        throw new Error(`Signing key ${id} is not Ed25519`);
      // Raw 32-byte public key = last 32 bytes of the SPKI DER encoding.
      const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
      return { id, privateKey, publicRaw: spki.subarray(spki.length - 32) };
    });
  }

  /** Keeps SigningKey in step with the configured keys: first ACTIVE, others RETIRED. */
  async onModuleInit(): Promise<void> {
    for (const [i, key] of this.keys.entries()) {
      const status = i === 0 ? 'ACTIVE' : 'RETIRED';
      await this.prisma.signingKey.upsert({
        where: { id: key.id },
        create: { id: key.id, publicKey: new Uint8Array(key.publicRaw), status },
        update: { status, ...(status === 'RETIRED' && { retiredAt: new Date() }) },
      });
    }
    this.logger.log({ active: this.activeKeyId() }, 'Signing keys loaded');
  }

  activeKeyId(): string {
    return this.keys[0]!.id;
  }

  /** Signs the canonical form of a string-only payload with the active key. */
  sign(payload: Record<string, string>): Buffer {
    return sign(null, Buffer.from(canonicalize(payload), 'utf8'), this.keys[0]!.privateKey);
  }

  async publicKeys(): Promise<PublicKeys> {
    const rows = await this.prisma.signingKey.findMany({ orderBy: { activatedAt: 'desc' } });
    return {
      keys: rows.map((k) => ({
        kid: k.id,
        algorithm: 'Ed25519' as const,
        publicKey: bytesToBase64Url(k.publicKey),
        status: k.status,
      })),
    };
  }
}
