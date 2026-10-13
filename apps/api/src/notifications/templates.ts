import { type NotificationMessage } from './notification.port';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

interface Body {
  subject: string;
  /** Paragraphs of plain text; the HTML version escapes them. */
  lines: string[];
  /** Call to action: label and absolute portal URL. */
  action?: { label: string; url: string };
  /** Codes and invitations: "ignore if this was not you". */
  unsolicited?: boolean;
}

const ORG = 'GovServe — Banadir Regional Administration';
const TZ = 'Africa/Mogadishu';

function when(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: TZ,
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

function day(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, dateStyle: 'long' });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * English templates (NFR-009). Emails carry only the first name, the reference number, a portal
 * link and, for appointments, when and where (FR-101). Never reasons, notes, IDs or amounts.
 */
function body({ template, vars }: NotificationMessage): Body {
  const ref = vars['referenceNo'] ?? '';
  const open = (label = 'View your application') =>
    vars['link'] ? { label, url: vars['link'] } : undefined;
  const code = (subject: string, line: string): Body => ({
    subject,
    lines: [line],
    unsolicited: true,
  });
  switch (template) {
    case 'VERIFY_EMAIL_CODE':
      return code(
        'Your GovServe verification code',
        `Your verification code is ${vars['code']}. It expires in 10 minutes.`,
      );
    case 'CHANGE_EMAIL_CODE':
      return code(
        'Confirm your new GovServe email address',
        `Enter code ${vars['code']} to confirm this email address. It expires in 10 minutes.`,
      );
    case 'RESET_PASSWORD_CODE':
      return code(
        'Reset your GovServe password',
        `Your password reset code is ${vars['code']}. It expires in 10 minutes.`,
      );
    case 'STAFF_DEVICE_CODE':
      return {
        subject: 'GovServe sign-in code',
        lines: [
          `A sign-in from a new device needs this code: ${vars['code']}. It expires in 10 minutes.`,
          'If this was not you, contact your administrator.',
        ],
        unsolicited: true,
      };
    case 'STAFF_INVITATION':
      return {
        subject: 'You have been invited to GovServe',
        lines: [
          `You have been invited to GovServe as ${vars['role']}. Set your password with the link below (valid 72 hours).`,
        ],
        ...(vars['link'] && { action: { label: 'Set your password', url: vars['link'] } }),
        unsolicited: true,
      };
    case 'APPLICATION_SUBMITTED':
      return {
        subject: `Application ${ref} received`,
        lines: [
          `We have received your application ${ref}.`,
          'Pay the fee shown in the portal so that an officer can start reviewing it.',
        ],
        action: open('Pay and track your application'),
      };
    case 'PAYMENT_RECEIVED':
      return {
        subject: `Payment details received for ${ref}`,
        lines: [
          `Thank you. We have received your payment details for application ${ref}.`,
          'An officer will check them. We will email you when the payment is confirmed.',
        ],
        action: open(),
      };
    case 'PAYMENT_CONFIRMED':
      return {
        subject: `Payment confirmed for ${ref}`,
        lines: [
          `Your payment for application ${ref} is confirmed. Your receipt is ready to download in the portal.`,
        ],
        action: open('Download your receipt'),
      };
    case 'PAYMENT_REJECTED':
      return {
        subject: `Payment not accepted for ${ref}`,
        lines: [
          `We could not accept a payment for application ${ref}.`,
          'Sign in to see why and to send the payment details again.',
        ],
        action: open(),
      };
    case 'CORRECTION_REQUESTED':
      return {
        subject: `Action needed: corrections for ${ref}`,
        lines: [
          `An officer has asked you to correct some details of application ${ref}.`,
          `Please make the changes by ${day(vars['dueAt'])}, or the application will be closed.`,
        ],
        action: open('Make the corrections'),
      };
    case 'CORRECTION_REMINDER':
      return {
        subject: `Reminder: ${vars['daysLeft'] === '1' ? '1 day' : `${vars['daysLeft']} days`} left to correct ${ref}`,
        lines: [
          `Corrections for application ${ref} are still needed. The deadline is ${day(vars['dueAt'])}.`,
          'If they are not made by then, the application will be closed.',
        ],
        action: open('Make the corrections'),
      };
    case 'APPOINTMENT_SCHEDULED':
    case 'APPOINTMENT_CHANGED':
      return {
        subject: `${template === 'APPOINTMENT_CHANGED' ? 'New appointment time' : 'Your appointment'} for ${ref}`,
        lines: [
          `${template === 'APPOINTMENT_CHANGED' ? 'Your appointment has been moved.' : 'An appointment has been booked for your application.'} Please come in person:`,
          `When: ${when(vars['appointmentAt'])}`,
          `Where: ${vars['location'] ?? ''}`,
          'Bring your original ID documents.',
        ],
        action: open('See the details'),
      };
    case 'CERTIFICATE_ISSUED':
      return {
        subject: `Your certificate is ready (${ref})`,
        lines: [
          `Your application ${ref} has been approved. Your certificate is ready to download.`,
        ],
        action: open('Download your certificate'),
      };
    case 'COPY_ISSUED':
      return {
        subject: `Your certified copy is ready (${ref})`,
        lines: [`The certified copy you ordered (${ref}) is ready to download.`],
        action: open('Download your copy'),
      };
    case 'APPLICATION_REJECTED':
      return {
        subject: `Decision on application ${ref}`,
        lines: [`Your application ${ref} was not approved. Sign in to see the decision.`],
        action: open(),
      };
    case 'APPLICATION_REFERRED':
      // FR-101: never the reason; the citizen is only told to visit in person.
      return {
        subject: `Application ${ref}: please visit in person`,
        lines: [
          `We cannot complete application ${ref} online.`,
          'Please visit the Criminal Investigation Department (CID) in person with your ID and this reference number.',
        ],
        action: open(),
      };
    case 'APPLICATION_WITHDRAWN':
      return {
        subject: `Application ${ref} withdrawn`,
        lines: [`Your application ${ref} has been withdrawn as you asked.`],
        action: open(),
      };
    case 'REFUND_PROCESSED':
      return {
        subject: `Refund processed for ${ref}`,
        lines: [`A refund for application ${ref} has been paid. Details are in the portal.`],
        action: open(),
      };
    case 'SLA_BREACHED':
      return {
        subject: `Overdue: application ${ref}`,
        lines: [`Application ${ref} in your department has passed its service deadline.`],
        action: open('Open the application'),
      };
  }
}

export function renderEmail(message: NotificationMessage): RenderedEmail {
  const b = body(message);
  const first = message.vars['firstName'];
  const hello = first ? `Hello ${first},` : 'Hello,';
  const closing = b.unsolicited ? 'If you did not request this, you can ignore this email.' : '';

  const text = [
    hello,
    ...b.lines,
    ...(b.action ? [`${b.action.label}: ${b.action.url}`] : []),
    `${ORG}${closing ? `\n${closing}` : ''}`,
  ].join('\n\n');

  const p = (s: string) => `<p style="margin:0 0 16px">${escapeHtml(s)}</p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(b.subject)}</title></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#0f172a">
<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:24px;border:1px solid #cbd5e1">
<p style="margin:0 0 16px;font-weight:bold;color:#1e3a8a">GovServe</p>
${p(hello)}
${b.lines.map(p).join('\n')}
${b.action ? `<p style="margin:24px 0"><a href="${escapeHtml(b.action.url)}" style="background:#1e3a8a;color:#ffffff;padding:12px 20px;text-decoration:none;font-weight:bold">${escapeHtml(b.action.label)}</a></p>` : ''}
<p style="margin:24px 0 0;font-size:13px;color:#475569">${escapeHtml(ORG)}${closing ? `<br>${escapeHtml(closing)}` : ''}</p>
</div></body></html>`;

  return { subject: b.subject, text, html };
}
