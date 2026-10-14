import { ConflictException, Injectable } from '@nestjs/common';
import { type CardGatewayPort } from './card-gateway.port';

const unavailable = () =>
  new ConflictException({
    code: 'CARD_UNAVAILABLE',
    message: 'Card payments are not available yet. Pay by mobile money, bank transfer or cash.',
  });

/** CARD_GATEWAY=disabled: no card payments until a real gateway is chosen (O-7). */
@Injectable()
export class DisabledCardGateway implements CardGatewayPort {
  createSession(): Promise<never> {
    return Promise.reject(unavailable());
  }

  /** No card payment can exist, so nothing is ever pending. */
  getStatus(): Promise<'FAILED'> {
    return Promise.resolve('FAILED');
  }

  refund(): Promise<never> {
    return Promise.reject(unavailable());
  }
}
