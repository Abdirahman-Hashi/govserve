import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type PublicKeys,
  PublicKeysSchema,
  type PublicReceipt,
  PublicReceiptSchema,
} from '@govserve/shared';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '../common/decorators/public.decorator';
import { ApiZodResponse, ZodPipe } from '../common/zod';
import { ReceiptsService } from './receipts.service';
import { SigningService } from './signing.service';

@ApiTags('verify')
@Public()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('verify')
export class VerifyController {
  constructor(
    private readonly receipts: ReceiptsService,
    private readonly signing: SigningService,
  ) {}

  @Get('keys')
  @ApiOperation({
    summary: 'Published signing keys',
    description:
      'Public. Ed25519 public keys (raw, base64url) used to sign receipts and certificates.',
  })
  @ApiZodResponse(200, PublicKeysSchema)
  keys(): Promise<PublicKeys> {
    return this.signing.publicKeys();
  }

  @Get('r/:receiptNo')
  @ApiOperation({
    summary: 'Verify a receipt',
    description:
      'Public. Status and the signed payload only: receipt number, service, amount, date and a masked name. No personal data.',
  })
  @ApiZodResponse(200, PublicReceiptSchema)
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  receipt(
    @Param('receiptNo', new ZodPipe(z.string().regex(/^R-\d{4}-\d{6,}$/))) receiptNo: string,
  ): Promise<PublicReceipt> {
    return this.receipts.publicReceipt(receiptNo);
  }
}
