import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  type AuthSession,
  type LoginResponse,
  type StaffRole,
  type DepartmentCode,
} from '@govserve/shared';
import request from 'supertest';
import { type App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { InMemoryNotificationAdapter } from '../../src/notifications/in-memory.adapter';
import {
  NOTIFICATION_PORT,
  type NotificationMessage,
} from '../../src/notifications/notification.port';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StaffService } from '../../src/users/staff.service';
import { startTestInfra, testEnv, type TestInfra } from '../testcontainers';

/**
 * Minimal cookie jar. supertest's own agent will not send Secure cookies over http,
 * but the API sets them Secure (as in production), so tests carry cookies by hand.
 */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  capture(res: request.Response): void {
    const header = res.headers['set-cookie'] as unknown;
    const list = Array.isArray(header)
      ? (header as string[])
      : typeof header === 'string'
        ? [header]
        : [];
    for (const raw of list) {
      const [pair] = raw.split(';');
      const [name, ...rest] = (pair ?? '').split('=');
      if (!name) continue;
      const value = rest.join('=');
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  clone(): CookieJar {
    const copy = new CookieJar();
    this.cookies.forEach((v, k) => copy.set(k, v));
    return copy;
  }
}

export interface Harness {
  app: INestApplication;
  infra: TestInfra;
  prisma: PrismaService;
  mail: InMemoryNotificationAdapter;
  http: () => App;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const infra = await startTestInfra();
  Object.assign(process.env, testEnv(infra));
  const mail = new InMemoryNotificationAdapter();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(NOTIFICATION_PORT)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  return {
    app,
    infra,
    mail,
    prisma: app.get(PrismaService),
    http: () => app.getHttpServer() as App,
    close: async () => {
      await app.close();
      await infra.stop();
    },
  };
}

/** Sends a request with the jar's cookies and captures any it sets. */
export async function send(jar: CookieJar, req: request.Test): Promise<request.Response> {
  const cookie = jar.header();
  const res = await (cookie ? req.set('Cookie', cookie) : req);
  jar.capture(res);
  return res;
}

export function codeFrom(
  mail: InMemoryNotificationAdapter,
  to: string,
  template: NotificationMessage['template'],
): string {
  const code = mail.last(to, template)?.vars['code'];
  if (!code) throw new Error(`No ${template} email for ${to}`);
  return code;
}

let counter = 0;
export function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@example.com`;
}

export const PASSWORD = 'mango river lantern 42';

/** Registers and verifies a citizen through the API; returns their session and jar. */
export async function signUpCitizen(h: Harness, email = uniqueEmail('citizen')) {
  const jar = new CookieJar();
  await send(
    jar,
    request(h.http()).post('/api/v1/auth/register').send({
      fullName: 'Amina Hassan',
      email,
      phone: '+252 61 234 5678',
      password: PASSWORD,
    }),
  ).then((r) => expect(r.status).toBe(202));
  const res = await send(
    jar,
    request(h.http())
      .post('/api/v1/auth/verify-email')
      .send({ email, code: codeFrom(h.mail, email, 'VERIFY_EMAIL_CODE') }),
  );
  expect(res.status).toBe(200);
  return { email, jar, session: res.body as AuthSession };
}

/** Creates a staff account via an invitation and completes the device check; returns a session. */
export async function signUpStaff(
  h: Harness,
  role: StaffRole,
  departmentCode: DepartmentCode | null,
  email = uniqueEmail(role.toLowerCase()),
) {
  const { link } = await h.app
    .get(StaffService)
    .invite(
      { id: null, role: null, type: 'SYSTEM' },
      { email, fullName: 'Hodan Ali', role, departmentCode },
    );
  const token = new URL(link).searchParams.get('token')!;
  await request(h.http())
    .post('/api/v1/auth/invitations/accept')
    .send({ token, password: PASSWORD })
    .expect(204);

  const jar = new CookieJar();
  const login = await send(
    jar,
    request(h.http()).post('/api/v1/auth/login').send({ email, password: PASSWORD }),
  );
  const body = login.body as LoginResponse;
  if (body.status !== 'OTP_REQUIRED')
    throw new Error('Expected a device challenge for a new staff device');
  const res = await send(
    jar,
    request(h.http())
      .post('/api/v1/auth/login/otp')
      .send({ challengeId: body.challengeId, code: codeFrom(h.mail, email, 'STAFF_DEVICE_CODE') }),
  );
  expect(res.status).toBe(200);
  return { email, jar, session: res.body as AuthSession };
}

export const bearer = (session: AuthSession) => ({
  Authorization: `Bearer ${session.accessToken}`,
});
