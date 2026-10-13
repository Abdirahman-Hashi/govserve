import { connect } from 'node:net';
import { type Readable } from 'node:stream';
import { type ScanResult, type VirusScanPort } from './virus-scan.port';

const CHUNK = 64 * 1024;

/**
 * Minimal clamd client using the INSTREAM command: the file is sent as length-prefixed
 * chunks and clamd answers "stream: OK" or "stream: <signature> FOUND".
 */
export class ClamAvAdapter implements VirusScanPort {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 60_000,
  ) {}

  scan(stream: Readable): Promise<ScanResult> {
    return new Promise<ScanResult>((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      let reply = '';
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        stream.destroy();
        reject(err);
      };
      socket.setTimeout(this.timeoutMs, () => fail(new Error('clamd timed out')));
      socket.on('error', fail);
      socket.on('data', (data: Buffer) => (reply += data.toString('utf8')));
      socket.on('end', () => {
        if (settled) return;
        settled = true;
        const text = reply.replace(/\0/g, '').trim();
        if (/: OK$/.test(text)) resolve({ clean: true });
        else if (/FOUND$/.test(text))
          resolve({ clean: false, signature: text.replace(/^.*?: /, '').replace(/ FOUND$/, '') });
        else reject(new Error(`Unexpected clamd reply: ${text.slice(0, 100)}`));
      });
      socket.on('connect', () => {
        void (async () => {
          try {
            socket.write('zINSTREAM\0');
            for await (const chunk of stream) {
              const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
              for (let i = 0; i < buf.length; i += CHUNK) {
                const part = buf.subarray(i, i + CHUNK);
                const size = Buffer.alloc(4);
                size.writeUInt32BE(part.length);
                if (!socket.write(Buffer.concat([size, part])))
                  await new Promise((r) => socket.once('drain', r));
              }
            }
            socket.end(Buffer.alloc(4)); // zero-length chunk ends the stream
          } catch (err) {
            fail(err as Error);
          }
        })();
      });
    });
  }
}
