import { NotificationTemplates } from '@govserve/shared';
import { escapeHtml, renderEmail } from './templates';

const vars = {
  firstName: 'Amina',
  referenceNo: 'GS-2026-000042',
  link: 'http://localhost:5173/citizen/applications/abc',
  code: '123456',
  role: 'Officer',
  daysLeft: '7',
  dueAt: '2026-11-12T10:00:00.000Z',
  appointmentAt: '2026-10-20T06:30:00.000Z',
  location: 'Banadir HQ, room 4',
};

describe('email templates', () => {
  it.each(NotificationTemplates)('should render %s as HTML and text', (template) => {
    const email = renderEmail({ to: 'a@example.com', template, vars });
    expect(email.subject.length).toBeGreaterThan(5);
    expect(email.text).toContain('Hello Amina,');
    expect(email.html).toContain('<!doctype html>');
    expect(email.html).toContain('Hello Amina,');
    // No raw undefined placeholders.
    expect(`${email.subject}${email.text}${email.html}`).not.toMatch(/undefined|\$\{/);
  });

  it('should put the reference and portal link in both versions', () => {
    const email = renderEmail({ to: 'a@example.com', template: 'CERTIFICATE_ISSUED', vars });
    for (const body of [email.text, email.html]) {
      expect(body).toContain('GS-2026-000042');
      expect(body).toContain('http://localhost:5173/citizen/applications/abc');
    }
  });

  it('should show appointment time in Mogadishu time and the place', () => {
    const email = renderEmail({ to: 'a@example.com', template: 'APPOINTMENT_SCHEDULED', vars });
    expect(email.text).toContain('09:30');
    expect(email.text).toContain('Banadir HQ, room 4');
  });

  it('should tell a referred applicant only to visit CID', () => {
    const email = renderEmail({
      to: 'a@example.com',
      template: 'APPLICATION_REFERRED',
      vars: { ...vars, note: 'Conviction 2015' },
    });
    expect(email.text).toContain('Criminal Investigation Department');
    expect(`${email.text}${email.html}`).not.toContain('Conviction');
  });

  it('should escape variables in HTML', () => {
    const email = renderEmail({
      to: 'a@example.com',
      template: 'APPLICATION_SUBMITTED',
      vars: { ...vars, firstName: '<script>x</script>' },
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });
});
