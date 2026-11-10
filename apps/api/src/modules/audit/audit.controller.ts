import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PaginationDto } from '../../common/pagination.dto';
import { Roles } from '../auth/auth.policy';
import { AuditService } from './audit.service';

@ApiTags('audit') @ApiCookieAuth('protarget_access')
@Controller('audit-logs') @Roles(Role.ADMIN)
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get()
  list(@Query() query: PaginationDto) { return this.audit.list(query); }
}
