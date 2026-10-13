import { Module } from '@nestjs/common';
import { ApplicationStateService } from './application-state.service';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  controllers: [ApplicationsController],
  providers: [ApplicationStateService, ApplicationsService],
  exports: [ApplicationStateService, ApplicationsService],
})
export class ApplicationsModule {}
