import { ThrottlerException } from '@nestjs/throttler';
import { BadRequestException, type ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { ErrorEnvelopeFilter } from './error-envelope.filter';

function run(exception: unknown): { status: number; body: unknown } {
  const result = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      result.status = code;
      return this;
    },
    json(body: unknown) {
      result.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ id: 'req-12345678' }), getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new ErrorEnvelopeFilter().catch(exception, host);
  return result;
}

describe('ErrorEnvelopeFilter', () => {
  it('should wrap HTTP exceptions in the error envelope when thrown', () => {
    expect(run(new NotFoundException('Application not found'))).toEqual({
      status: 404,
      body: {
        error: { code: 'NOT_FOUND', message: 'Application not found', requestId: 'req-12345678' },
      },
    });
  });

  it('should return validation messages as details when the ValidationPipe rejects input', () => {
    const { status, body } = run(new BadRequestException(['email must be an email']));
    expect(status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: ['email must be an email'],
        requestId: 'req-12345678',
      },
    });
  });

  it('should give a plain message when the caller is rate limited', () => {
    expect(run(new ThrottlerException())).toEqual({
      status: 429,
      body: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many attempts. Please wait a minute and try again.',
          requestId: 'req-12345678',
        },
      },
    });
  });

  it('should hide internals when the error is unexpected', () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { status, body } = run(new Error('db password is hunter2'));
    expect(logError).toHaveBeenCalledTimes(1);
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
