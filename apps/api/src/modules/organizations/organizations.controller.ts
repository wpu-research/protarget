import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/identity';
import { PaginationDto } from '../../common/pagination.dto';
import { Roles } from '../auth/auth.policy';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto, UpdateOrganizationDto } from './organizations.dto';

@ApiTags('organizations') @ApiCookieAuth('protarget_access') @Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}
  @Get() @Roles(Role.ADMIN, Role.AGENCY, Role.ADVERTISER)
  list(@Req() req: AuthRequest, @Query() query: PaginationDto) {
    return this.organizations.list(req.principal, query);
  }
  @Get(':id') @Roles(Role.ADMIN, Role.AGENCY, Role.ADVERTISER)
  get(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.organizations.get(req.principal, id);
  }
  @Post() @Roles(Role.ADMIN)
  create(@Req() req: AuthRequest, @Body() dto: CreateOrganizationDto) {
    return this.organizations.create(req.principal, dto);
  }
  @Patch(':id') @Roles(Role.ADMIN)
  update(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrganizationDto) {
    return this.organizations.update(req.principal, id, dto);
  }
}
