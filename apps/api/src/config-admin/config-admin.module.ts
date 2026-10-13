import { Module } from '@nestjs/common';
import { ConfigAdminController, StaffReasonCodesController } from './config-admin.controller';
import { ConfigAdminService } from './config-admin.service';

@Module({
  controllers: [ConfigAdminController, StaffReasonCodesController],
  providers: [ConfigAdminService],
  exports: [ConfigAdminService],
})
export class ConfigAdminModule {}
