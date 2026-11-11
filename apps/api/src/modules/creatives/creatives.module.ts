import { Module } from '@nestjs/common';
import { createStorage, OBJECT_STORAGE, storageConfig } from '../../common/storage/object-storage';
import { CreativesController } from './creatives.controller';
import { CreativesService } from './creatives.service';

@Module({
  controllers: [CreativesController],
  providers: [CreativesService, { provide: OBJECT_STORAGE, useFactory: () => createStorage(storageConfig(process.env)) }],
  exports: [CreativesService, OBJECT_STORAGE],
})
export class CreativesModule {}
