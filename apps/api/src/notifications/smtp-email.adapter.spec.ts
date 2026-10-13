import { Logger } from '@nestjs/common';
import { type Transporter } from 'nodemailer';
import { type AppConfig } from '../config/config.module';
import { NotificationDeliveryError } from './notification-delivery.error';
import { SmtpEmailAdapter } from './smtp-email.adapter';

const config = { SMTP_FROM: 'GovServe <no-reply@govserve.local>' } as AppConfig;
const recipient = 'amina.hassan@example.com';

/** Shape of a nodemailer error when the server rejects every recipient. */
function rejectedError(): Error {
  return Object.assign(
    new Error(`Can't send mail - all recipients were rejected: 550 5.1.1 <${recipient}>: unknown`),
    {
      code: 'EENVELOPE',
      responseCode: 550,
      rejected: [recipient],
      response: `550 5.1.1 <${recipient}>: unknown`,
    },
  );
}

describe('SmtpEmailAdapter', () => {
  it('should rethrow transport failures without the recipient address', async () => {
    const transport = {
      sendMail: () => Promise.reject(rejectedError()),
      close: () => undefined,
    } as unknown as Transporter;
    const adapter = new SmtpEmailAdapter(config, transport);
    const thrown = await adapter
      .send({
        to: recipient,
        template: 'VERIFY_EMAIL_CODE',
        vars: { firstName: 'Amina', code: '123456' },
      })
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(NotificationDeliveryError);
    expect(thrown).toMatchObject({
      template: 'VERIFY_EMAIL_CODE',
      transportCode: 'EENVELOPE',
      responseCode: 550,
    });
    const serialised = JSON.stringify({
      ...(thrown as object),
      message: (thrown as Error).message,
      stack: (thrown as Error).stack,
    });
    expect(serialised).not.toContain(recipient);
    expect(serialised).not.toContain('123456');
  });

  it('should send rendered mail when the transport succeeds', async () => {
    const sendMail = jest.fn(() => Promise.resolve({}));
    const adapter = new SmtpEmailAdapter(config, {
      sendMail,
      close: () => undefined,
    } as unknown as Transporter);
    await adapter.send({
      to: recipient,
      template: 'VERIFY_EMAIL_CODE',
      vars: { firstName: 'Amina', code: '123456' },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: recipient, from: config.SMTP_FROM }),
    );
  });
});

describe('NotificationDeliveryError', () => {
  it('should keep only non-identifying fields when built from an arbitrary error', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const safe = NotificationDeliveryError.from('STAFF_INVITATION', rejectedError());
    expect(Object.keys(safe)).toEqual(
      expect.arrayContaining(['template', 'transportCode', 'responseCode']),
    );
    expect(JSON.stringify(safe) + safe.message).not.toContain(recipient);
  });
});
