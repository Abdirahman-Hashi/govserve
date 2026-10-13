import { type Readable } from 'node:stream';

export type ScanResult = { clean: true } | { clean: false; signature: string };

/** Virus scanning (FR-035). Files stay QUARANTINED until a scanner says CLEAN. */
export interface VirusScanPort {
  scan(stream: Readable): Promise<ScanResult>;
}

export const VIRUS_SCAN_PORT = Symbol('VIRUS_SCAN_PORT');

/** Local development and tests only; refused in production by the config check. */
export class NoopVirusScanner implements VirusScanPort {
  async scan(stream: Readable): Promise<ScanResult> {
    // Drain the stream so the underlying connection is released.
    for await (const _chunk of stream) {
      // discard
    }
    return { clean: true };
  }
}
