import { ResetPasswordRequestSchema } from '@govserve/shared';
import { Link, useSearchParams } from 'react-router';
import { useResetPassword } from '../../api/auth';
import { AuthCard, FormAlert, SubmitButton, TextField } from '../../components/form';
import { useZodForm } from '../../forms/useZodForm';
import { t } from '../../strings';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';
  const reset = useResetPassword();
  const form = useZodForm(ResetPasswordRequestSchema, { email, code: '', password: '' });

  if (reset.isSuccess) {
    return (
      <AuthCard heading={t.reset.heading}>
        <FormAlert tone="success">{t.reset.done}</FormAlert>
        <Link to="/login" className="text-brand underline">
          {t.nav.signIn}
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard heading={t.reset.heading} intro={t.reset.intro(email)}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((body) => reset.mutateAsync(body))}
      >
        {form.formError && <FormAlert>{form.formError}</FormAlert>}
        <TextField
          label={t.fields.code}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          error={form.errors['code']}
          {...form.field('code')}
        />
        <TextField
          label={t.fields.newPassword}
          hint={t.fields.passwordHint}
          type="password"
          autoComplete="new-password"
          error={form.errors['password']}
          {...form.field('password')}
        />
        <SubmitButton pending={reset.isPending}>{t.reset.submit}</SubmitButton>
      </form>
    </AuthCard>
  );
}
