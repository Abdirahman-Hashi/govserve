import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { ClamAvAdapter } from './clamav.adapter';
import { DocumentsController } from './documents.controller';
import { DocumentsProcessor } from './documents.processor';
import { DOCUMENTS_QUEUE, DocumentsService } from './documents.service';
import { NoopVirusScanner, VIRUS_SCAN_PORT } from './virus-scan.port';

@Module({
  imports: [BullModule.registerQueue({ name: DOCUMENTS_QUEUE })],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentsProcessor,
    {
      provide: VIRUS_SCAN_PORT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.VIRUS_SCANNER === 'clamav'
          ? new ClamAvAdapter(config.CLAMAV_HOST, config.CLAMAV_PORT)
          : new NoopVirusScanner(),
    },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
