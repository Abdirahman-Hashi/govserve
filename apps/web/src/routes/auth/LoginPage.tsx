import {
  LoginOtpRequestSchema,
  LoginRequestSchema,
  ROLE_HOME,
  type AuthSession,
} from '@govserve/shared';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useLogin, useLoginOtp } from '../../api/auth';
import { ApiError } from '../../api/client';
import { AuthCard, FormAlert, SubmitButton, TextField } from '../../components/form';
import { useZodForm } from '../../forms/useZodForm';
import { t } from '../../strings';

/** Only same-site paths are accepted as a post-login destination. */
function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const login = useLogin();
  const loginOtp = useLoginOtp();
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const credentials = useZodForm(LoginRequestSchema, { email: '', password: '' });
  const otp = useZodForm(LoginOtpRequestSchema, { code: '' });

  const done = (session: AuthSession) =>
    navigate(safeNext(params.get('next')) ?? ROLE_HOME[session.user.role], { replace: true });

  if (challengeId) {
    return (
      <AuthCard heading={t.login.otpHeading} intro={t.login.otpIntro}>
        <form
          noValidate
          className="space-y-4"
          onSubmit={otp.handleSubmit(
            async (body) => done(await loginOtp.mutateAsync(body)),
            (v) => ({ challengeId, code: v['code'] }),
          )}
        >
          {otp.formError && <FormAlert>{otp.formError}</FormAlert>}
          <TextField
            label={t.fields.code}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            error={otp.errors['code']}
            {...otp.field('code')}
          />
          <SubmitButton pending={loginOtp.isPending}>{t.login.otpSubmit}</SubmitButton>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard heading={t.login.heading}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={credentials.handleSubmit(async (body) => {
          try {
            const res = await login.mutateAsync(body);
            if (res.status === 'OTP_REQUIRED') setChallengeId(res.challengeId);
            else await done(res);
          } catch (err) {
            if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
              await navigate(`/verify?email=${encodeURIComponent(body.email)}`);
              return;
            }
            throw err;
          }
        })}
      >
        {credentials.formError && <FormAlert>{credentials.formError}</FormAlert>}
        <TextField
          label={t.fields.email}
          type="email"
          autoComplete="username"
          inputMode="email"
          error={credentials.errors['email']}
          {...credentials.field('email')}
        />
        <TextField
          label={t.fields.password}
          type="password"
          autoComplete="current-password"
          error={credentials.errors['password']}
          {...credentials.field('password')}
        />
        <SubmitButton pending={login.isPending}>{t.login.submit}</SubmitButton>
      </form>
      <p className="text-sm">
        <Link to="/forgot-password" className="text-brand underline">
          {t.login.forgot}
        </Link>
      </p>
      <p className="text-sm">
        {t.login.noAccount}{' '}
        <Link to="/register" className="text-brand underline">
          {t.nav.register}
        </Link>
      </p>
    </AuthCard>
  );
}
