import { Global, Module } from '@nestjs/common';
import { AddonsController } from './addons.controller';
import { AddonsService } from './addons.service';
/** Global so later add-on modules can call `requireEnabled` inside their own transactions. */
@Global() @Module({ controllers: [AddonsController], providers: [AddonsService], exports: [AddonsService] })
export class AddonsModule {}
