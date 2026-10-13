import { Module } from '@nestjs/common';
import { AdminCatalogueController } from './admin-catalogue.controller';
import { CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';

@Module({
  controllers: [CatalogueController, AdminCatalogueController],
  providers: [CatalogueService],
  exports: [CatalogueService],
})
export class CatalogueModule {}
