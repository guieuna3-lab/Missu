/**
 * 오류 응답의 모양을 통일합니다. 내부 오류 내용이나 DB 접속정보는 사용자에게 보내지 않습니다.
 * requestId로 실패한 요청을 구분할 수 있습니다.
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export function fail(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException ? exception.getResponse() : {};
    const details =
      typeof body === 'object'
        ? (body as {
            code?: string;
            message?: string | string[];
            fields?: Record<string, string[]>;
          })
        : {};
    response.status(status).json({
      error: {
        code:
          details.code ??
          {
            400: 'VALIDATION_ERROR',
            401: 'AUTH_REQUIRED',
            403: 'FORBIDDEN',
            404: 'RESOURCE_NOT_FOUND',
            413: 'FILE_TOO_LARGE',
            415: 'FILE_TYPE_UNSUPPORTED',
            429: 'RATE_LIMITED',
            503: 'EXTERNAL_UNAVAILABLE',
          }[status] ??
          'INTERNAL_ERROR',
        message:
          status >= 500
            ? '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.'
            : (details.message ?? '요청을 확인하세요.'),
        requestId: request.headers['x-request-id'] ?? randomUUID(),
        ...(status === 400 && details.fields ? { fields: details.fields } : {}),
      },
    });
  }
}
