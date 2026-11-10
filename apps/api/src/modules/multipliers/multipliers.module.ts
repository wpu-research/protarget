import { Module } from '@nestjs/common';
import { MultipliersController } from './multipliers.controller';
import { MultipliersService } from './multipliers.service';
@Module({ controllers: [MultipliersController], providers: [MultipliersService] })
export class MultipliersModule {}
