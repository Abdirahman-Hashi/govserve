import { ForgotPasswordRequestSchema } from '@govserve/shared';
import { useNavigate } from 'react-router';
import { useForgotPassword } from '../../api/auth';
import { AuthCard, FormAlert, SubmitButton, TextField } from '../../components/form';
import { useZodForm } from '../../forms/useZodForm';
import { t } from '../../strings';

export function ForgotPasswordPage() {
  const forgot = useForgotPassword();
  const navigate = useNavigate();
  const form = useZodForm(ForgotPasswordRequestSchema, { email: '' });
  return (
    <AuthCard heading={t.forgot.heading} intro={t.forgot.intro}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit(async (body) => {
          await forgot.mutateAsync(body);
          await navigate(`/reset-password?email=${encodeURIComponent(body.email)}`);
        })}
      >
        {form.formError && <FormAlert>{form.formError}</FormAlert>}
        <TextField
          label={t.fields.email}
          type="email"
          autoComplete="email"
          inputMode="email"
          error={form.errors['email']}
          {...form.field('email')}
        />
        <SubmitButton pending={forgot.isPending}>{t.forgot.submit}</SubmitButton>
      </form>
    </AuthCard>
  );
}
