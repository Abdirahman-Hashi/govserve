import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job } from 'bullmq';
import { DOCUMENTS_QUEUE, DocumentsService, SCAN_JOB } from './documents.service';

/** Virus scans run off the request path (ADR-0005); failures retry with backoff. */
@Processor(DOCUMENTS_QUEUE)
export class DocumentsProcessor extends WorkerHost {
  constructor(private readonly documents: DocumentsService) {
    super();
  }

  async process(job: Job<{ documentId: string }>): Promise<void> {
    if (job.name === SCAN_JOB) await this.documents.scan(job.data.documentId);
  }
}
