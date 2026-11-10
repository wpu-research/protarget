import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { InvitationMailer } from './invitation-mailer.service';

@Module({ controllers: [UsersController], providers: [UsersService, InvitationMailer] })
export class UsersModule {}
