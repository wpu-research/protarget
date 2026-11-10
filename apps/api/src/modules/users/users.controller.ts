import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/identity';
import { PaginationDto } from '../../common/pagination.dto';
import { Roles } from '../auth/auth.policy';
import { InviteUserDto, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users') @ApiCookieAuth('protarget_access') @Controller('users') @Roles(Role.ADMIN)
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get()
  list(@Query() query: PaginationDto) { return this.users.list(query); }
  @Patch(':id')
  update(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(req.principal, id, dto);
  }
  @Post('invite')
  invite(@Req() req: AuthRequest, @Body() dto: InviteUserDto) { return this.users.invite(req.principal, dto); }
}
