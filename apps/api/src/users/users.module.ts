import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, StaffController],
  providers: [UsersService, StaffService],
  exports: [StaffService],
})
export class UsersModule {}
