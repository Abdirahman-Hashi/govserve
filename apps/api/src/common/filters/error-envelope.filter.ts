import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type Request, type Response } from 'express';

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/** Every error leaves the API as { error: { code, message, details, requestId } } (NFR-010). */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const requestId = req.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorEnvelope['error'] = { code: 'INTERNAL_ERROR', message: 'Internal server error' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'object' && response !== null && 'message' in response
          ? response.message
          : exception.message;
      body = { code: CODE_BY_STATUS[status] ?? `HTTP_${status}`, message: exception.message };
      // class-validator returns an array of messages; surface them as details.
      if (exception instanceof BadRequestException && Array.isArray(message)) {
        body = { code: 'VALIDATION_FAILED', message: 'Validation failed', details: message };
      }
    } else {
      this.logger.error({ err: exception, requestId }, 'Unhandled exception');
    }

    res.status(status).json({ error: { ...body, requestId } } satisfies ErrorEnvelope);
  }
}
