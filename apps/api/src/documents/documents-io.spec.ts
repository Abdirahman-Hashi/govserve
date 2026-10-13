import { createServer, type Server } from 'node:net';
import { Readable } from 'node:stream';
import { ClamAvAdapter } from './clamav.adapter';
import { sniffMime } from './file-type';

describe('sniffMime', () => {
  it.each([
    ['PDF', Buffer.from('%PDF-1.7\n'), 'application/pdf'],
    ['JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), 'image/jpeg'],
    ['PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    ['HTML pretending to be a PDF', Buffer.from('<html><script>'), null],
    ['Windows executable', Buffer.from('MZ\x90\x00\x03\x00\x00\x00'), null],
    ['empty file', Buffer.alloc(0), null],
  ])('should identify %s by its first bytes', (_label, bytes, expected) => {
    expect(sniffMime(bytes)).toBe(expected);
  });
});

/** Fake clamd that parses INSTREAM chunks and flags any stream containing "EICAR". */
function fakeClamd(): Promise<{ server: Server; port: number; received: () => string }> {
  let received = '';
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let commandSeen = false;
    socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      if (!commandSeen) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        if (buffer.subarray(0, end).toString() !== 'zINSTREAM')
          return socket.end('UNKNOWN COMMAND\0');
        commandSeen = true;
        buffer = buffer.subarray(end + 1);
      }
      while (buffer.length >= 4) {
        const len = buffer.readUInt32BE(0);
        if (len === 0) {
          socket.end(
            received.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0',
          );
          return;
        }
        if (buffer.length < 4 + len) return;
        received += buffer.subarray(4, 4 + len).toString('latin1');
        buffer = buffer.subarray(4 + len);
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        port: typeof address === 'object' && address ? address.port : 0,
        received: () => received,
      });
    }),
  );
}

describe('ClamAvAdapter', () => {
  it('should stream the whole file in chunks and report clean files', async () => {
    const clamd = await fakeClamd();
    const big = Buffer.alloc(200 * 1024, 'a');
    const result = await new ClamAvAdapter('127.0.0.1', clamd.port).scan(Readable.from([big]));
    expect(result).toEqual({ clean: true });
    expect(clamd.received().length).toBe(big.length);
    clamd.server.close();
  });

  it('should report the signature when clamd finds a virus', async () => {
    const clamd = await fakeClamd();
    const result = await new ClamAvAdapter('127.0.0.1', clamd.port).scan(
      Readable.from([Buffer.from('X5O!P%@AP EICAR-STANDARD')]),
    );
    expect(result).toEqual({ clean: false, signature: 'Eicar-Test-Signature' });
    clamd.server.close();
  });

  it('should reject when clamd is unreachable', async () => {
    await expect(
      new ClamAvAdapter('127.0.0.1', 1).scan(Readable.from([Buffer.from('x')])),
    ).rejects.toThrow();
  });
});
