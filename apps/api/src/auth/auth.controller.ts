import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AcceptInvitationRequest,
  AcceptInvitationRequestSchema,
  type AuthSession,
  AuthSessionSchema,
  type ForgotPasswordRequest,
  ForgotPasswordRequestSchema,
  type LoginOtpRequest,
  LoginOtpRequestSchema,
  type LoginRequest,
  LoginRequestSchema,
  type LoginResponse,
  LoginResponseSchema,
  type RegisterRequest,
  RegisterRequestSchema,
  type ResendCodeRequest,
  ResendCodeRequestSchema,
  type ResetPasswordRequest,
  ResetPasswordRequestSchema,
  type VerifyEmailRequest,
  VerifyEmailRequestSchema,
} from '@govserve/shared';
import { type Request, type Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { ReqCtx, type RequestContext } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../common/zod';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { AUTH_POLICY, REFRESH_COOKIE } from './auth.constants';
import { AuthService, type IssuedSession } from './auth.service';
import {
  assertTrustedOrigin,
  clearRefreshCookie,
  ensureDeviceId,
  readCookie,
  setRefreshCookie,
} from './cookies';

/** Stricter limit for credential and code endpoints (NFR-001). */
const AUTH_THROTTLE = { default: { limit: AUTH_POLICY.authRequestsPerMinute, ttl: 60_000 } };
const SESSION_THROTTLE = { default: { limit: AUTH_POLICY.sessionRequestsPerMinute, ttl: 60_000 } };

const examples = {
  register: {
    fullName: 'Amina Hassan',
    email: 'amina@example.com',
    phone: '+252 61 234 5678',
    password: 'mango river lantern 42',
  },
  verify: { email: 'amina@example.com', code: '123456' },
  login: { email: 'amina@example.com', password: 'mango river lantern 42' },
  otp: { challengeId: '0199e0a8-7c1b-7d2e-9f00-1a2b3c4d5e6f', code: '123456' },
  reset: { email: 'amina@example.com', code: '123456', password: 'new long passphrase 7' },
  invitation: {
    token: 'kq3J9...one-time-token-from-the-email',
    password: 'mango river lantern 42',
  },
};

@ApiTags('auth')
@Public()
@Throttle(AUTH_THROTTLE)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Register a citizen account',
    description:
      'Public. Always 202 so the endpoint cannot reveal whether an email is registered; a 6-digit code is emailed to new accounts.',
  })
  @ApiZodBody(RegisterRequestSchema, examples.register)
  @ApiResponse({ status: 202, description: 'Verification code sent if the account is new' })
  async register(
    @Body(new ZodPipe(RegisterRequestSchema)) body: RegisterRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<void> {
    await this.auth.register(body, ctx);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify the email code and sign in',
    description: 'Public. Sets the refresh cookie.',
  })
  @ApiZodBody(VerifyEmailRequestSchema, examples.verify)
  @ApiZodResponse(200, AuthSessionSchema)
  @ApiResponse({ status: 400, description: 'CODE_INVALID, CODE_EXPIRED or CODE_TOO_MANY_ATTEMPTS' })
  async verifyEmail(
    @Body(new ZodPipe(VerifyEmailRequestSchema)) body: VerifyEmailRequest,
    @ReqCtx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    return this.withCookie(res, await this.auth.verifyEmail(body.email, body.code, ctx));
  }

  @Post('resend-code')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Resend the email verification code',
    description: 'Public. Always 202; at most one code per minute.',
  })
  @ApiZodBody(ResendCodeRequestSchema, { email: 'amina@example.com' })
  @ApiResponse({ status: 202, description: 'A new code was sent if one was due' })
  async resendCode(
    @Body(new ZodPipe(ResendCodeRequestSchema)) body: ResendCodeRequest,
  ): Promise<void> {
    await this.auth.resendVerification(body.email);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in',
    description:
      'Public. Returns a session, or OTP_REQUIRED for staff on a new device (a code is emailed). Unknown, locked and deactivated accounts all get 401 INVALID_CREDENTIALS.',
  })
  @ApiZodBody(LoginRequestSchema, examples.login)
  @ApiZodResponse(200, LoginResponseSchema)
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  @ApiResponse({ status: 403, description: 'EMAIL_NOT_VERIFIED' })
  async login(
    @Body(new ZodPipe(LoginRequestSchema)) body: LoginRequest,
    @ReqCtx() ctx: RequestContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const outcome = await this.auth.login(body, ensureDeviceId(req, res, this.config), ctx);
    if (outcome.status === 'OTP_REQUIRED') return outcome;
    return { status: 'OK', ...this.withCookie(res, outcome.issued) };
  }

  @Post('login/otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a staff sign-in from a new device',
    description:
      'Public. Requires the same browser (device cookie) that started the login; trusts the device for 30 days.',
  })
  @ApiZodBody(LoginOtpRequestSchema, examples.otp)
  @ApiZodResponse(200, AuthSessionSchema)
  @ApiResponse({ status: 400, description: 'CODE_INVALID, CODE_EXPIRED or CODE_TOO_MANY_ATTEMPTS' })
  async loginOtp(
    @Body(new ZodPipe(LoginOtpRequestSchema)) body: LoginOtpRequest,
    @ReqCtx() ctx: RequestContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    const deviceId = ensureDeviceId(req, res, this.config);
    return this.withCookie(
      res,
      await this.auth.completeDeviceChallenge(body.challengeId, body.code, deviceId, ctx),
    );
  }

  @Post('refresh')
  @Throttle(SESSION_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh cookie and get a new access token',
    description:
      'Public; authenticated by the httpOnly refresh cookie. Reusing an old refresh token revokes the whole session family.',
  })
  @ApiZodResponse(200, AuthSessionSchema)
  @ApiResponse({ status: 401, description: 'SESSION_EXPIRED' })
  @ApiResponse({ status: 403, description: 'BAD_ORIGIN' })
  async refresh(
    @ReqCtx() ctx: RequestContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    assertTrustedOrigin(req, this.config);
    const token = readCookie(req, REFRESH_COOKIE);
    if (!token)
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Please sign in again' });
    try {
      return this.withCookie(res, await this.auth.refresh(token, ctx));
    } catch (err) {
      clearRefreshCookie(res, this.config);
      throw err;
    }
  }

  @Post('logout')
  @Throttle(SESSION_THROTTLE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sign out this session',
    description: 'Public; revokes the session in the refresh cookie and clears it.',
  })
  @ApiResponse({ status: 204, description: 'Signed out (also returned when there was no session)' })
  @ApiResponse({ status: 403, description: 'BAD_ORIGIN' })
  async logout(
    @ReqCtx() ctx: RequestContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    assertTrustedOrigin(req, this.config);
    await this.auth.logout(readCookie(req, REFRESH_COOKIE), ctx);
    clearRefreshCookie(res, this.config);
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Email a password reset code', description: 'Public. Always 202.' })
  @ApiZodBody(ForgotPasswordRequestSchema, { email: 'amina@example.com' })
  @ApiResponse({ status: 202, description: 'A reset code was sent if the account exists' })
  async forgot(
    @Body(new ZodPipe(ForgotPasswordRequestSchema)) body: ForgotPasswordRequest,
  ): Promise<void> {
    await this.auth.forgotPassword(body.email);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set a new password with the emailed code',
    description: 'Public. Signs the user out everywhere.',
  })
  @ApiZodBody(ResetPasswordRequestSchema, examples.reset)
  @ApiResponse({ status: 204, description: 'Password changed; all sessions signed out' })
  @ApiResponse({ status: 400, description: 'CODE_INVALID, CODE_EXPIRED or CODE_TOO_MANY_ATTEMPTS' })
  async reset(
    @Body(new ZodPipe(ResetPasswordRequestSchema)) body: ResetPasswordRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<void> {
    await this.auth.resetPassword(body, ctx);
  }

  @Post('invitations/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Accept a staff invitation and set a password',
    description: 'Public; authorised by the one-time token from the invitation email.',
  })
  @ApiZodBody(AcceptInvitationRequestSchema, examples.invitation)
  @ApiResponse({ status: 204, description: 'Account created; sign in to continue' })
  @ApiResponse({ status: 400, description: 'INVITATION_INVALID' })
  @ApiResponse({ status: 409, description: 'EMAIL_IN_USE' })
  async acceptInvitation(
    @Body(new ZodPipe(AcceptInvitationRequestSchema)) body: AcceptInvitationRequest,
    @ReqCtx() ctx: RequestContext,
  ): Promise<void> {
    await this.auth.acceptInvitation(body, ctx);
  }

  private withCookie(res: Response, issued: IssuedSession): AuthSession {
    setRefreshCookie(res, this.config, issued.refreshToken, issued.refreshExpiresAt);
    return issued.session;
  }
}
