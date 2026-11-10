import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RuntimeConfig } from '../../common/runtime-config';
import { AuthController, MeController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { SessionService } from './session.service';

@Global()
@Module({
  controllers: [AuthController, MeController],
  providers: [RuntimeConfig, AuthService, SessionService, AuthRateLimitService,
    { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [RuntimeConfig, SessionService],
})
export class AuthModule {}
