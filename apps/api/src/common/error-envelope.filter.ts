import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorEnvelope } from '@protarget/shared';
import { ApiError } from './api-error';
import { Prisma } from '@prisma/client';
import { redact } from './redact';

const STATUS_CODES: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'INVALID_STATE_TRANSITION',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

/** Loggable shape of an unexpected error. The message is deliberately dropped: SMTP/Prisma
 * messages may embed credentials, tokens or query values. Frames carry only code locations.
 */
export function describeError(error: unknown): { errorName: string; errorCode?: string; frames: string[] } {
  if (!(error instanceof Error)) return { errorName: typeof error, frames: [] };
  const code = (error as { code?: unknown }).code;
  return {
    errorName: error.constructor?.name || error.name || 'Error',
    ...(typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code) ? { errorCode: code } : {}),
    frames: (error.stack ?? '').split('\n').map(line => line.trim())
      .filter(line => line.startsWith('at ')).slice(0, 8),
  };
}

/** Tüm hataları Spec v2 §33 zarfına çevirir: { error: { code, message, details } } */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorEnvelope = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} } };

    if (exception instanceof ApiError) {
      status = exception.status;
      body = { error: { code: exception.code, message: exception.message,
        details: redact(exception.details) as Record<string, unknown> } };
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
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      status = 409;
      body = { error: { code: 'INVALID_STATE_TRANSITION', message: 'Resource already exists', details: {} } };
    } else {
      // Never serialize arbitrary errors: SMTP/Prisma messages may contain credentials or tokens.
      const requestId = host.switchToHttp().getRequest().requestId;
      // Diagnostics without the message: class name, driver code and stack frames only.
      console.error(JSON.stringify({ level: 'error', msg: 'request failed', requestId, ...describeError(exception) }));
    }

    res.status(status).json(body);
  }
}
