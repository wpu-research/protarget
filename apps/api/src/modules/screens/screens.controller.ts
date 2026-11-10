import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/identity';
import { Roles } from '../auth/auth.policy';
import { ScreensService } from './screens.service';
import { CreateScreenDto, ScreenPageDto, ScreenQueryDto, ScreenResponseDto, UpdateScreenDto } from './screens.dto';

@ApiTags('screens') @ApiCookieAuth('protarget_access') @Controller('screens')
export class ScreensController {
  constructor(private readonly screens: ScreensService) {}
  @Get() @Roles(Role.ADMIN) @ApiOkResponse({ type: ScreenPageDto })
  list(@Req() req: AuthRequest, @Query() query: ScreenQueryDto): Promise<ScreenPageDto> {
    return this.screens.list(req.principal, query);
  }
  @Get(':id') @Roles(Role.ADMIN) @ApiOkResponse({ type: ScreenResponseDto })
  get(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<ScreenResponseDto> {
    return this.screens.get(req.principal, id);
  }
  @Post() @Roles(Role.ADMIN) @ApiCreatedResponse({ type: ScreenResponseDto })
  create(@Req() req: AuthRequest, @Body() dto: CreateScreenDto): Promise<ScreenResponseDto> {
    return this.screens.create(req.principal, dto);
  }
  @Patch(':id') @Roles(Role.ADMIN) @ApiOkResponse({ type: ScreenResponseDto })
  update(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateScreenDto): Promise<ScreenResponseDto> {
    return this.screens.update(req.principal, id, dto);
  }
}
