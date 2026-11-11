/** 미슈 API 서버의 시작점입니다. 개발 중에는 /docs에서 각 기능의 입력·응답을 확인합니다. */
import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module';
import { setupApp } from './setup-app';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { completeOpenApi } from './openapi';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(
    AppModule,
    process.env.OBSERVE_APP_KEY && process.env.OBSERVE_APP_SECRET
      ? { instrument: ObserveInstrument }
      : {},
  );
  setupApp(app);
  if (process.env.NODE_ENV !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('MissU MVP API')
        .setDescription(
          '가입·인증·물품·지도·요청·대화·반환 API. 로컬 인증번호는 .local/outbox에만 저장하며 실제 발송은 외부 서비스 설정이 필요합니다. 먼저 /auth/csrf를 호출하고 변경 요청에 최신 X-CSRF-Token을 사용하세요. 개발 정책 버전은 dev-v1입니다.',
        )
        .setVersion('0.2.0')
        .addCookieAuth(
          config().cookieName,
          { type: 'apiKey', in: 'cookie' },
          'sessionCookie',
        )
        .build(),
    );
    SwaggerModule.setup('docs', app, completeOpenApi(document));
  }
  await app.listen(
    Number(process.env.PORT ?? 3000),
    process.env.HOST ?? (config().production ? '0.0.0.0' : '127.0.0.1'),
  );
}
void bootstrap();
