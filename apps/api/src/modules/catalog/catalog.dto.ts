import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { LowerUuid, Optional } from '../../common/inventory-validation';
import { PaginationDto } from '../../common/pagination.dto';

export class CatalogQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @LowerUuid() @IsUUID() venueId?: string;
}
