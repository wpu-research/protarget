import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/identity';
import { Roles } from '../auth/auth.policy';
import { VenuesService } from './venues.service';
import { CreateVenueDto, UpdateVenueDto, VenuePageDto, VenueQueryDto, VenueResponseDto } from './venues.dto';

@ApiTags('venues') @ApiCookieAuth('protarget_access') @Controller('venues')
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}
  @Get() @Roles(Role.ADMIN) @ApiOkResponse({ type: VenuePageDto })
  list(@Req() req: AuthRequest, @Query() query: VenueQueryDto): Promise<VenuePageDto> {
    return this.venues.list(req.principal, query);
  }
  @Get(':id') @Roles(Role.ADMIN) @ApiOkResponse({ type: VenueResponseDto })
  get(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string): Promise<VenueResponseDto> {
    return this.venues.get(req.principal, id);
  }
  @Post() @Roles(Role.ADMIN) @ApiCreatedResponse({ type: VenueResponseDto })
  create(@Req() req: AuthRequest, @Body() dto: CreateVenueDto): Promise<VenueResponseDto> {
    return this.venues.create(req.principal, dto);
  }
  @Patch(':id') @Roles(Role.ADMIN) @ApiOkResponse({ type: VenueResponseDto })
  update(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVenueDto): Promise<VenueResponseDto> {
    return this.venues.update(req.principal, id, dto);
  }
}
