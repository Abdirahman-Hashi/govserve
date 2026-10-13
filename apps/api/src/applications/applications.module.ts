import { Module } from '@nestjs/common';
import { ConfigAdminModule } from '../config-admin/config-admin.module';
import { MoneyModule } from '../payments/money.module';
import { ApplicationStateService } from './application-state.service';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  imports: [MoneyModule, ConfigAdminModule],
  controllers: [ApplicationsController],
  providers: [ApplicationStateService, ApplicationsService],
  exports: [ApplicationStateService, ApplicationsService],
})
export class ApplicationsModule {}
