import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { ApiError, ErrorCode } from '@pos/core';

import { ApiException } from './api-exception.js';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/** Fixed messages: a framework or parser message can quote the request body. */
const CLIENT_ERRORS: Readonly<Record<number, readonly [ErrorCode, string]>> = {
  400: ['VALIDATION_FAILED', 'The request is not valid'],
  401: ['UNAUTHORIZED', 'Authentication is required'],
  404: ['NOT_FOUND', 'Not found'],
  413: ['PAYLOAD_TOO_LARGE', 'The request body is too large'],
  429: ['RATE_LIMITED', 'Too many requests'],
};

function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  // Express middleware such as the body parser reports its status on the error.
  const status = (exception as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : 500;
}

function toResponse(exception: unknown): { status: number; body: ApiError } {
  if (exception instanceof ApiException) {
    const { status, code, message, extra } = exception;
    return { status, body: { error: { code, message }, ...extra } };
  }
  const status = statusOf(exception);
  if (status >= 500) {
    return {
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
    };
  }
  const [code, message] = CLIENT_ERRORS[status] ?? CLIENT_ERRORS[400]!;
  return { status, body: { error: { code, message } } };
}

function describeError(exception: unknown) {
  if (!(exception instanceof Error)) return { type: typeof exception };
  const { name, message, stack } = exception;
  // Prisma validation errors print the whole query, including customer-facing data.
  if (name === 'PrismaClientValidationError') return { type: name };
  return { type: name, message, stack };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = toResponse(exception);
    if (status >= 500) {
      this.logger.error({ msg: 'unhandled error', error: describeError(exception) });
    }
    host.switchToHttp().getResponse<JsonResponse>().status(status).json(body);
  }
}
