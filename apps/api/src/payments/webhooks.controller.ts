import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiExcludeController,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { formatUsd } from '@govserve/shared';
import { type Request, type Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { CARD_GATEWAY, type CardGatewayPort, CardWebhookEventSchema } from './card-gateway.port';
import { MockCardGateway } from './mock-card-gateway';
import { PaymentsService } from './payments.service';
import { SIGNATURE_HEADER, verifyWebhook } from './webhook-signature';

@ApiTags('payments')
@Public()
@SkipThrottle()
@Controller('payments/webhooks')
export class CardWebhookController {
  private readonly logger = new Logger(CardWebhookController.name);

  constructor(
    private readonly payments: PaymentsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('card')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Card gateway webhook',
    description:
      'Public; authenticated by an HMAC-SHA256 signature over "timestamp.rawBody" (±5 min). Idempotent per gateway event ID. Confirms (P10), fails (P11) or reverses (P9) card payments and settles card refunds (R4/R5).',
  })
  @ApiHeader({
    name: SIGNATURE_HEADER,
    required: true,
    description: 't=<unix seconds>,v1=<hex HMAC>',
  })
  @ApiResponse({ status: 200, description: '{ result: APPLIED | DUPLICATE | IGNORED }' })
  @ApiResponse({ status: 401, description: 'BAD_SIGNATURE' })
  @ApiResponse({ status: 422, description: 'VALIDATION_FAILED' })
  async card(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers(SIGNATURE_HEADER) signature?: string,
  ): Promise<{ result: string }> {
    const check = verifyWebhook(this.config.CARD_WEBHOOK_SECRET, req.rawBody, signature);
    if (check !== 'OK') {
      this.logger.warn({ check }, 'Rejected card webhook');
      throw new UnauthorizedException({
        code: 'BAD_SIGNATURE',
        message: 'Webhook signature is not valid',
      });
    }
    // Parse the exact bytes that were signed, not a re-serialised body.
    const parsed = CardWebhookEventSchema.safeParse(JSON.parse(req.rawBody!.toString('utf8')));
    if (!parsed.success)
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Unexpected webhook payload',
      });
    return { result: await this.payments.onCardEvent(parsed.data) };
  }
}

/** Development-only checkout page for the mock card gateway (CARD_GATEWAY=mock, never in production). */
@ApiExcludeController()
@Public()
@Controller('mock-gateway')
export class MockGatewayController {
  constructor(
    @Inject(CARD_GATEWAY) private readonly gateway: CardGatewayPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('checkout/:ref')
  checkout(@Param('ref') ref: string, @Res() res: Response): void {
    const mock = this.mock();
    const session = mock.sessions.get(ref);
    if (!session) throw new NotFoundException();
    const amount = formatUsd(session.amountCents);
    // form-action also governs the redirect after submit, which returns to the web app.
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(this.config.WEB_ORIGIN).origin}`,
    );
    res.type('html')
      .send(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock card checkout</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 1rem}button{font-size:1rem;padding:.75rem 1.25rem;margin:.5rem .5rem 0 0}</style></head>
<body><h1>Mock card checkout</h1><p>Development only — no real card is charged.</p><p>Amount: <strong>${amount}</strong></p>
<form method="post" action="${ref}/pay"><button type="submit">Pay ${amount}</button></form>
<form method="post" action="${ref}/decline"><button type="submit">Decline</button></form></body></html>`);
  }

  @Post('checkout/:ref/:outcome')
  async complete(
    @Param('ref') ref: string,
    @Param('outcome') outcome: string,
    @Res() res: Response,
  ): Promise<void> {
    if (outcome !== 'pay' && outcome !== 'decline') throw new NotFoundException();
    const returnUrl = await this.mock().complete(ref, outcome);
    if (!returnUrl) throw new NotFoundException();
    res.redirect(303, returnUrl);
  }

  private mock(): MockCardGateway {
    if (!(this.gateway instanceof MockCardGateway)) throw new NotFoundException();
    return this.gateway;
  }
}
