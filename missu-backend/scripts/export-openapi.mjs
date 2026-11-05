import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { writeFile } from 'node:fs/promises';
import { AppModule } from '../dist/app.module.js';
import { completeOpenApi } from '../dist/openapi.js';
import { config } from '../dist/config.js';
const app = await NestFactory.create(AppModule, { logger: false });
try {
  const document = completeOpenApi(
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('MissU MVP API')
        .setVersion('0.2.0')
        .addCookieAuth(
          config().cookieName,
          { type: 'apiKey', in: 'cookie' },
          'sessionCookie',
        )
        .build(),
    ),
  );
  await writeFile(
    'docs/openapi.json',
    JSON.stringify(document, null, 2) + '\n',
  );
  console.log('docs/openapi.json 저장 완료');
} finally {
  await app.close();
}
