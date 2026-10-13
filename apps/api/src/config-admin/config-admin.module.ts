import { Module } from '@nestjs/common';
import { ConfigAdminController } from './config-admin.controller';
import { ConfigAdminService } from './config-admin.service';

@Module({
  controllers: [ConfigAdminController],
  providers: [ConfigAdminService],
  exports: [ConfigAdminService],
})
export class ConfigAdminModule {}
