import { RegisterRequestSchema } from '@govserve/shared';
import { Link, useNavigate } from 'react-router';
import { useRegister } from '../../api/auth';
import { AuthCard, FormAlert, SubmitButton, TextField } from '../../components/form';
import { useZodForm } from '../../forms/useZodForm';
import { t } from '../../strings';

export function RegisterPage() {
  const register = useRegister();
  const navigate = useNavigate();
  const form = useZodForm(RegisterRequestSchema, {
    fullName: '',
    email: '',
    phone: '',
    password: '',
  });

  return (
    <AuthCard heading={t.register.heading} intro={t.register.intro}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit(async (body) => {
          await register.mutateAsync(body);
          await navigate(`/verify?email=${encodeURIComponent(body.email)}`);
        })}
      >
        {form.formError && <FormAlert>{form.formError}</FormAlert>}
        <TextField
          label={t.fields.fullName}
          autoComplete="name"
          error={form.errors['fullName']}
          {...form.field('fullName')}
        />
        <TextField
          label={t.fields.email}
          type="email"
          autoComplete="email"
          inputMode="email"
          error={form.errors['email']}
          {...form.field('email')}
        />
        <TextField
          label={t.fields.phone}
          hint={t.fields.phoneHint}
          type="tel"
          autoComplete="tel"
          error={form.errors['phone']}
          {...form.field('phone')}
        />
        <TextField
          label={t.fields.password}
          hint={t.fields.passwordHint}
          type="password"
          autoComplete="new-password"
          error={form.errors['password']}
          {...form.field('password')}
        />
        <SubmitButton pending={register.isPending}>{t.register.submit}</SubmitButton>
      </form>
      <p className="text-sm">
        {t.register.haveAccount}{' '}
        <Link to="/login" className="text-brand underline">
          {t.nav.signIn}
        </Link>
      </p>
    </AuthCard>
  );
}
