import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  bytesToBase64Url,
  formatUsd,
  maskName,
  type PublicReceipt,
  type ReceiptPayload,
} from '@govserve/shared';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { type Payment, type Prisma, type Receipt } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SigningService } from './signing.service';

/** Fiscal year = calendar year in Africa/Mogadishu (UTC+3). */
export function fiscalYear(instant: Date): number {
  return new Date(instant.getTime() + 3 * 3_600_000).getUTCFullYear();
}

/**
 * Receipts (FR-060): gap-free numbers per fiscal year and an Ed25519-signed payload. The
 * PDF is rendered from the stored payload on demand, so it is always identical.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signing: SigningService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Issues the receipt inside the confirming transaction. The counter row is incremented
   * atomically (row lock until commit): a rollback releases the number, so there are no gaps.
   */
  async issue(
    tx: Prisma.TransactionClient,
    payment: Payment,
    info: { serviceName: string; applicantName: string },
    now = new Date(),
  ): Promise<Receipt> {
    const year = fiscalYear(now);
    const [row] = await tx.$queryRaw<[{ value: bigint }]>`
      INSERT INTO "counter" ("name", "nextValue") VALUES (${`receipt:${year}`}, 2)
      ON CONFLICT ("name") DO UPDATE SET "nextValue" = "counter"."nextValue" + 1
      RETURNING "nextValue" - 1 AS value`;
    const receiptNo = `R-${year}-${row.value.toString().padStart(6, '0')}`;
    const payload: ReceiptPayload = {
      t: 'RCPT',
      no: receiptNo,
      svc: info.serviceName,
      iss: now.toISOString(),
      h: maskName(info.applicantName),
      amt: payment.amountCents.toString(),
      kid: this.signing.activeKeyId(),
    };
    return tx.receipt.create({
      data: {
        receiptNo,
        paymentId: payment.id,
        applicationId: payment.applicationId,
        amountCents: payment.amountCents,
        issuedAt: now,
        payloadJson: payload,
        signature: new Uint8Array(this.signing.sign(payload)),
        keyId: payload.kid,
      },
    });
  }

  /** Public verification data: no personal details beyond the masked name in the signed payload. */
  async publicReceipt(receiptNo: string): Promise<PublicReceipt> {
    const receipt = await this.prisma.receipt.findUnique({
      where: { receiptNo },
      include: { payment: { include: { refunds: { where: { status: 'COMPLETED' } } } } },
    });
    if (!receipt) throw new NotFoundException();
    const payload = receipt.payloadJson as ReceiptPayload;
    return {
      receiptNo,
      serviceName: payload.svc,
      amountCents: receipt.amountCents.toString(),
      issuedAt: receipt.issuedAt.toISOString(),
      status: receiptStatus(receipt.payment),
      payload,
    };
  }

  verifyUrl(receipt: Pick<Receipt, 'receiptNo' | 'signature'>): string {
    return `${this.config.WEB_ORIGIN}/verify/r/${encodeURIComponent(receipt.receiptNo)}#sig=${bytesToBase64Url(receipt.signature)}`;
  }

  /** Renders the receipt PDF (A5 portrait) with the verification QR code. */
  async pdf(
    receipt: Receipt & {
      payment: Payment & { refunds: { status: string; amountCents: bigint }[] };
    },
    referenceNo: string | null,
  ): Promise<Buffer> {
    const payload = receipt.payloadJson as ReceiptPayload;
    const url = this.verifyUrl(receipt);
    const qr = await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
    const doc = new PDFDocument({
      size: 'A5',
      margin: 40,
      info: { Title: `Receipt ${receipt.receiptNo}`, Author: 'GovServe' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    doc.fontSize(16).text('Banadir Regional Administration', { align: 'center' });
    doc.fontSize(11).text('GovServe — Official payment receipt', { align: 'center' }).moveDown(1.2);
    const row = (label: string, value: string) =>
      doc
        .fontSize(10)
        .text(`${label}: `, { continued: true })
        .font('Helvetica-Bold')
        .text(value)
        .font('Helvetica');
    row('Receipt number', receipt.receiptNo);
    row('Date', new Date(payload.iss).toLocaleString('en-GB', { timeZone: 'Africa/Mogadishu' }));
    row('Service', payload.svc);
    if (referenceNo) row('Application reference', referenceNo);
    row('Paid by', payload.h);
    row('Payment method', receipt.payment.channel.replace('_', ' ').toLowerCase());
    row('Amount', `${formatUsd(receipt.amountCents)} (USD)`);
    const status = receiptStatus(receipt.payment);
    if (status !== 'VALID') row('Status', status);
    doc.moveDown(1);
    doc.image(qr, { fit: [130, 130], align: 'center' });
    doc
      .moveDown(0.5)
      .fontSize(8)
      .text(
        'Scan to verify this receipt online. The QR code contains a digital signature (Ed25519).',
        { align: 'center' },
      );
    doc.fontSize(7).fillColor('#555').text(`Signing key: ${receipt.keyId}`, { align: 'center' });
    doc.end();
    return done;
  }
}

/** VALID, or REFUNDED when fully refunded, or REVERSED after a chargeback. */
export function receiptStatus(
  payment: Pick<Payment, 'status' | 'amountCents'> & {
    refunds: { status: string; amountCents: bigint }[];
  },
): 'VALID' | 'REFUNDED' | 'REVERSED' {
  if (payment.status === 'REVERSED') return 'REVERSED';
  const refunded = payment.refunds
    .filter((r) => r.status === 'COMPLETED')
    .reduce((s, r) => s + r.amountCents, 0n);
  return refunded >= payment.amountCents ? 'REFUNDED' : 'VALID';
}
