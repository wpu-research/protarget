import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Request, Response } from 'express';
import { RuntimeConfig } from '../../common/runtime-config';
import type { AuthRequest } from '../../common/identity';
import { ApiError } from '../../common/api-error';
import { clientAddress } from '../../common/client-address';
import { AuthService } from './auth.service';
import { AcceptInviteDto, LoginDto } from './auth.dto';
import { Public, Roles } from './auth.policy';
import { ACCESS_COOKIE, REFRESH_COOKIE, clearAuthCookies, readCookie, setAuthCookies } from './tokens';

@ApiTags('authentication') @Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: RuntimeConfig) {}

  @Public() @Post('login') @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto, clientAddress(req, this.config.values.proxySecret));
    setAuthCookies(res, this.config, result);
    return { user: result.user };
  }

  @Public() @Post('refresh') @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const result = await this.auth.refresh(readCookie(req, REFRESH_COOKIE), clientAddress(req, this.config.values.proxySecret));
      setAuthCookies(res, this.config, result);
      return { user: result.user };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) clearAuthCookies(res, this.config);
      throw error;
    }
  }

  // Idempotent even when cookies expired, user was disabled, or the session is already revoked.
  @Public() @Post('logout') @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.logout(readCookie(req, ACCESS_COOKIE), readCookie(req, REFRESH_COOKIE));
    clearAuthCookies(res, this.config);
    return result;
  }

  @Public() @Post('accept-invite') @HttpCode(200)
  accept(@Body() dto: AcceptInviteDto, @Req() req: Request) {
    return this.auth.acceptInvite(dto, clientAddress(req, this.config.values.proxySecret));
  }
}

@ApiTags('identity') @ApiCookieAuth('protarget_access') @Controller()
export class MeController {
  @Get('me') @Roles(Role.ADMIN, Role.AGENCY, Role.ADVERTISER, Role.SUPPORT)
  me(@Req() req: AuthRequest) { return req.principal.user; }
}
