import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorEnvelope } from '@protarget/shared';
import { ApiError } from './api-error';

const STATUS_CODES: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'INVALID_STATE_TRANSITION',
  429: 'RATE_LIMITED',
};

/** Tüm hataları Spec v2 §33 zarfına çevirir: { error: { code, message, details } } */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorEnvelope = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} } };

    if (exception instanceof ApiError) {
      status = exception.status;
      body = { error: { code: exception.code, message: exception.message, details: exception.details } };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      const message = typeof payload === 'string' ? payload : ((payload as { message?: unknown }).message ?? exception.message);
      body = {
        error: {
          code: STATUS_CODES[status] ?? 'INTERNAL_ERROR',
          message: Array.isArray(message) ? 'Validation failed' : String(message),
          details: Array.isArray(message) ? { issues: message } : {},
        },
      };
    } else {
      // Beklenmeyen hata: ayrıntı istemciye sızmaz, loga yazılır.
      console.error(JSON.stringify({ level: 'error', msg: 'unhandled exception', error: String(exception), stack: (exception as Error)?.stack }));
    }

    res.status(status).json(body);
  }
}
