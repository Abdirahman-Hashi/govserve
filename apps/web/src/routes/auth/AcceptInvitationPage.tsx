import { AcceptInvitationRequestSchema } from '@govserve/shared';
import { Link, useSearchParams } from 'react-router';
import { useAcceptInvitation } from '../../api/auth';
import { AuthCard, FormAlert, SubmitButton, TextField } from '../../components/form';
import { useZodForm } from '../../forms/useZodForm';
import { t } from '../../strings';

export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const accept = useAcceptInvitation();
  const form = useZodForm(AcceptInvitationRequestSchema, { token, password: '' });

  if (!token) {
    return (
      <AuthCard heading={t.invitation.heading}>
        <FormAlert>{t.invitation.missing}</FormAlert>
      </AuthCard>
    );
  }
  if (accept.isSuccess) {
    return (
      <AuthCard heading={t.invitation.heading}>
        <FormAlert tone="success">{t.invitation.done}</FormAlert>
        <Link to="/login" className="text-brand underline">
          {t.nav.signIn}
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard heading={t.invitation.heading} intro={t.invitation.intro}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((body) => accept.mutateAsync(body))}
      >
        {form.formError && <FormAlert>{form.formError}</FormAlert>}
        <TextField
          label={t.fields.password}
          hint={t.fields.passwordHint}
          type="password"
          autoComplete="new-password"
          error={form.errors['password']}
          {...form.field('password')}
        />
        <SubmitButton pending={accept.isPending}>{t.invitation.submit}</SubmitButton>
      </form>
    </AuthCard>
  );
}
