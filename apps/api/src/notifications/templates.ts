import { type NotificationMessage } from './notification.port';

export interface RenderedEmail {
  subject: string;
  text: string;
}

const footer =
  '\n\nGovServe — Banadir Regional Administration\nIf you did not request this, you can ignore this email.';

/** English templates (NFR-009: strings in one place). HTML versions arrive with Phase 07. */
export function renderEmail({ template, vars }: NotificationMessage): RenderedEmail {
  const hello = `Hello ${vars['firstName'] ?? ''},`.replace(' ,', ',');
  switch (template) {
    case 'VERIFY_EMAIL_CODE':
      return {
        subject: 'Your GovServe verification code',
        text: `${hello}\n\nYour verification code is ${vars['code']}. It expires in 10 minutes.${footer}`,
      };
    case 'CHANGE_EMAIL_CODE':
      return {
        subject: 'Confirm your new GovServe email address',
        text: `${hello}\n\nEnter code ${vars['code']} to confirm this email address. It expires in 10 minutes.${footer}`,
      };
    case 'RESET_PASSWORD_CODE':
      return {
        subject: 'Reset your GovServe password',
        text: `${hello}\n\nYour password reset code is ${vars['code']}. It expires in 10 minutes.${footer}`,
      };
    case 'STAFF_DEVICE_CODE':
      return {
        subject: 'GovServe sign-in code',
        text: `${hello}\n\nA sign-in from a new device needs this code: ${vars['code']}. It expires in 10 minutes.\nIf this was not you, contact your administrator.${footer}`,
      };
    case 'STAFF_INVITATION':
      return {
        subject: 'You have been invited to GovServe',
        text: `${hello}\n\nYou have been invited to GovServe as ${vars['role']}. Set your password here (valid 72 hours):\n${vars['link']}${footer}`,
      };
  }
}
