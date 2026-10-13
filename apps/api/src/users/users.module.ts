import { Module } from '@nestjs/common';
import { ReviewModule } from '../review/review.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [ReviewModule],
  controllers: [UsersController, StaffController],
  providers: [UsersService, StaffService],
  exports: [StaffService],
})
export class UsersModule {}
