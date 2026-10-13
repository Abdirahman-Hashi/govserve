import { ROLE_HOME, VerifyEmailRequestSchema } from '@govserve/shared';
import { useNavigate, useSearchParams } from 'react-router';
import { useResendCode, useVerifyEmail } from '../../api/auth';
import { AuthCard, FormAlert, SubmitButton, TextField } from '../../components/form';
import { useZodForm } from '../../forms/useZodForm';
import { t } from '../../strings';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';
  const verify = useVerifyEmail();
  const resend = useResendCode();
  const navigate = useNavigate();
  const form = useZodForm(VerifyEmailRequestSchema, { email, code: '' });

  return (
    <AuthCard heading={t.verify.heading} intro={t.verify.intro(email)}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit(async (body) => {
          const session = await verify.mutateAsync(body);
          await navigate(ROLE_HOME[session.user.role], { replace: true });
        })}
      >
        {form.formError && <FormAlert>{form.formError}</FormAlert>}
        {resend.isSuccess && <FormAlert tone="success">{t.verify.resent}</FormAlert>}
        <TextField
          label={t.fields.code}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          error={form.errors['code']}
          {...form.field('code')}
        />
        <div className="flex flex-wrap items-center gap-4">
          <SubmitButton pending={verify.isPending}>{t.verify.submit}</SubmitButton>
          <button
            type="button"
            className="text-brand underline"
            onClick={() => resend.mutate({ email })}
            disabled={resend.isPending || !email}
          >
            {t.verify.resend}
          </button>
        </div>
      </form>
    </AuthCard>
  );
}
