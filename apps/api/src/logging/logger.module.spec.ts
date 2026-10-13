import { type IncomingMessage, type ServerResponse } from 'node:http';
import { requestId } from './logger.module';

function call(header?: string): { id: string; echoed: unknown } {
  const req = {
    headers: header === undefined ? {} : { 'x-request-id': header },
  } as IncomingMessage;
  let echoed: unknown;
  const res = { setHeader: (_: string, v: unknown) => (echoed = v) } as unknown as ServerResponse;
  return { id: requestId(req, res), echoed };
}

describe('requestId', () => {
  it('should reuse the incoming ID when it is well formed', () => {
    expect(call('abc12345-req')).toEqual({ id: 'abc12345-req', echoed: 'abc12345-req' });
  });

  it('should mint a UUID when the incoming ID is missing or unsafe', () => {
    expect(call().id).toMatch(/^[0-9a-f-]{36}$/);
    expect(call('bad id\n<script>').id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
