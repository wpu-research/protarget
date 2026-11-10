import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../modules/auth/auth.policy';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public() @Get()
  async check(): Promise<{ status: 'ok'; database: 'up'; time: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      // Readiness must fail before the Phase 0 identity migration is deployed.
      await this.prisma.session.findFirst({ select: { id: true } });
    } catch {
      throw new ServiceUnavailableException('Database unreachable');
    }
    return { status: 'ok', database: 'up', time: new Date().toISOString() };
  }
}
