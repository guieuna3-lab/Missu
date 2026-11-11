/**
 * Prisma는 TypeScript 코드와 PostgreSQL 사이에서 데이터를 읽고 쓰는 역할을 합니다.
 * 서버 전체에서 연결을 공유하고, 서버가 종료되면 연결을 정리합니다.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { config } from '../config';

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: config().databaseUrl,
        max: 10,
        connectionTimeoutMillis: 5000,
      }),
    });
  }
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
