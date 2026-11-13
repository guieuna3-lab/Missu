/**
 * NestJS 모듈은 관련 컨트롤러와 서비스를 묶는 상자입니다.
 * 기존 AppModule에 이 모듈을 추가하여 기본 Hello World 코드와 미슈 기능을 함께 유지합니다.
 */
import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { AuthController } from './auth/auth.controller';
import { SessionService } from './auth/session.service';
import { DatabaseService } from './database/database.service';
import { IdempotencyService } from './common/idempotency.service';
import { ItemsController } from './items/items.controller';
import { ItemsService } from './items/items.service';
import { UploadsController } from './uploads/uploads.controller';
import { UploadsService } from './uploads/uploads.service';
import { LostReportsController } from './lost-reports/lost-reports.controller';
import { UsersController } from './users/users.controller';
import { HealthController } from './health.controller';
import { RegistrationController } from './auth/registration.controller';
import { RegistrationService } from './auth/registration.service';
import { ClaimsController } from './claims/claims.controller';
import { ClaimsService } from './claims/claims.service';
import { NearbyService } from './items/nearby.service';
import { PlacesController } from './items/places.controller';
import { InstitutionItemsController } from './items/institution-items.controller';
import { InstitutionItemsService } from './items/institution-items.service';
import { RateLimitService } from './common/rate-limit.service';
import { ExternalHttpService } from './integrations/external-http.service';
import { DeliveryService } from './integrations/delivery.service';
import { StorageService } from './integrations/storage.service';
import { MaintenanceService } from './maintenance/maintenance.service';
import { RoutesController } from './routes/routes.controller';
import { RoutesService } from './routes/routes.service';

@Global()
@Module({
  controllers: [
    AuthController,
    ItemsController,
    UploadsController,
    LostReportsController,
    UsersController,
    HealthController,
    RegistrationController,
    ClaimsController,
    PlacesController,
    InstitutionItemsController,
    RoutesController,
  ],
  providers: [
    DatabaseService,
    SessionService,
    IdempotencyService,
    ItemsService,
    UploadsService,
    RegistrationService,
    ClaimsService,
    NearbyService,
    InstitutionItemsService,
    RateLimitService,
    ExternalHttpService,
    DeliveryService,
    StorageService,
    MaintenanceService,
    RoutesService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [DatabaseService],
})
export class MissuModule {}
