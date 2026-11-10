import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/identity';
import { PaginationDto } from '../../common/pagination.dto';
import { Roles } from '../auth/auth.policy';
import { MultipliersService } from './multipliers.service';
import { ApproveMultiplierDto, CreateMultiplierDto, MultiplierHistoryDto, MultiplierResponseDto } from './multipliers.dto';

@ApiTags('multipliers') @ApiCookieAuth('protarget_access') @Controller('screens/:screenId/multipliers')
export class MultipliersController {
  constructor(private readonly multipliers: MultipliersService) {}
  @Get() @Roles(Role.ADMIN) @ApiOkResponse({ type: MultiplierHistoryDto })
  history(@Req() req: AuthRequest, @Param('screenId', ParseUUIDPipe) screenId: string, @Query() query: PaginationDto): Promise<MultiplierHistoryDto> {
    return this.multipliers.history(req.principal, screenId, query);
  }
  @Post() @Roles(Role.ADMIN) @ApiCreatedResponse({ type: MultiplierResponseDto })
  create(@Req() req: AuthRequest, @Param('screenId', ParseUUIDPipe) screenId: string, @Body() dto: CreateMultiplierDto): Promise<MultiplierResponseDto> {
    return this.multipliers.create(req.principal, screenId, dto);
  }
  @Post(':id/approve') @HttpCode(200) @Roles(Role.ADMIN) @ApiOkResponse({ type: MultiplierResponseDto })
  approve(@Req() req: AuthRequest, @Param('screenId', ParseUUIDPipe) screenId: string,
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveMultiplierDto): Promise<MultiplierResponseDto> {
    return this.multipliers.approve(req.principal, screenId, id, dto);
  }
}
