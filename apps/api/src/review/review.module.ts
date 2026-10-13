import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { CertificatesModule } from '../certificates/certificates.module';
import { ConfigAdminModule } from '../config-admin/config-admin.module';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

@Module({
  imports: [ApplicationsModule, CertificatesModule, ConfigAdminModule],
  controllers: [ReviewController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
