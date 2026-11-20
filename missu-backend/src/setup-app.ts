/**
 * 입력 검증, 쿠키 읽기, 오류 형식 등 모든 API에 공통으로 필요한 설정입니다.
 * 서버 실행과 통합 시험에서 같은 설정을 써야 테스트와 실제 동작이 일치합니다.
 */
import {
  INestApplication,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { ApiErrorFilter } from './common/http';

export function setupApp(app: INestApplication) {
  // 직접 접속은 0. 신뢰하는 프록시를 배치한 경우에만 운영 설정에서 홉 수를 지정합니다.
  const express = app.getHttpAdapter().getInstance() as {
    set: (name: string, value: number) => void;
  };
  express.set('trust proxy', config().trustProxyHops);
  app.use(helmet());
  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });
  app.enableCors({
    origin: config().origins,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'Idempotency-Key',
      'X-Missu-Session',
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
      exceptionFactory: (errors: ValidationError[]) => {
        const fields: Record<string, string[]> = {};
        const visit = (rows: ValidationError[], parent = '') => {
          for (const row of rows) {
            const path = parent ? parent + '.' + row.property : row.property;
            if (row.constraints) fields[path] = Object.values(row.constraints);
            if (row.children) visit(row.children, path);
          }
        };
        visit(errors);
        return new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: '입력 내용을 확인하세요.',
          fields,
        });
      },
    }),
  );
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();
}
