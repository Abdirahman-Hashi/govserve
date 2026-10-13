import {
  ChangeEmailRequestSchema,
  ConfirmEmailChangeRequestSchema,
  type Profile,
  UpdateProfileRequestSchema,
} from '@govserve/shared';
import { useState } from 'react';
import {
  useConfirmEmailChange,
  useMyProfile,
  useRequestEmailChange,
  useUpdateProfile,
} from '../../api/users';
import { FormAlert, SelectField, SubmitButton, TextField } from '../../components/form';
import { useZodForm } from '../../forms/useZodForm';
import { t } from '../../strings';

/** Drops empty inputs so only fields the user filled in are sent. */
const filled = (values: Record<string, string>) =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''));

function ProfileForm({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const isCitizen = profile.role === 'CITIZEN';
  const form = useZodForm(UpdateProfileRequestSchema, {
    fullName: profile.fullName,
    phone: profile.phone ?? '',
    nationalIdType: profile.nationalIdType ?? 'NATIONAL_ID',
    nationalId: '',
    dateOfBirth: profile.dateOfBirth ?? '',
  });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(
        async (body) => {
          await update.mutateAsync(body);
          form.setValues((v) => ({ ...v, nationalId: '' }));
        },
        (v) => {
          const body = filled(v);
          if (!isCitizen) return { fullName: body['fullName'], phone: body['phone'] };
          if (!body['nationalId']) delete body['nationalIdType'];
          return body;
        },
      )}
    >
      {form.formError && <FormAlert>{form.formError}</FormAlert>}
      {update.isSuccess && <FormAlert tone="success">{t.profile.saved}</FormAlert>}
      <TextField
        label={t.fields.fullName}
        autoComplete="name"
        error={form.errors['fullName']}
        {...form.field('fullName')}
      />
      <TextField
        label={t.fields.phone}
        hint={t.fields.phoneHint}
        type="tel"
        autoComplete="tel"
        error={form.errors['phone']}
        {...form.field('phone')}
      />
      {isCitizen && (
        <fieldset className="space-y-4 rounded-md border border-slate-300 p-4">
          <legend className="px-1 font-semibold">{t.profile.identity}</legend>
          <p className="text-sm text-slate-600">{t.profile.identityHint}</p>
          {profile.nationalIdMasked && (
            <p className="text-sm">{t.profile.currentId(profile.nationalIdMasked)}</p>
          )}
          <SelectField
            label={t.fields.nationalIdType}
            options={[
              { value: 'NATIONAL_ID', label: t.idTypes.NATIONAL_ID },
              { value: 'PASSPORT', label: t.idTypes.PASSPORT },
            ]}
            error={form.errors['nationalIdType']}
            {...form.field('nationalIdType')}
          />
          <TextField
            label={t.fields.nationalId}
            autoComplete="off"
            error={form.errors['nationalId']}
            {...form.field('nationalId')}
          />
          <TextField
            label={t.fields.dateOfBirth}
            type="date"
            autoComplete="bday"
            error={form.errors['dateOfBirth']}
            {...form.field('dateOfBirth')}
          />
        </fieldset>
      )}
      <SubmitButton pending={update.isPending}>{t.profile.save}</SubmitButton>
    </form>
  );
}

function EmailChange({ current }: { current: string }) {
  const request = useRequestEmailChange();
  const confirm = useConfirmEmailChange();
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const requestForm = useZodForm(ChangeEmailRequestSchema, { newEmail: '' });
  const confirmForm = useZodForm(ConfirmEmailChangeRequestSchema, { code: '' });

  return (
    <section aria-labelledby="email-heading" className="space-y-3">
      <h2 id="email-heading" className="text-lg font-semibold">
        {t.profile.emailHeading}
      </h2>
      <p className="text-sm">{current}</p>
      {confirm.isSuccess && <FormAlert tone="success">{t.profile.emailChanged}</FormAlert>}
      {pendingEmail && !confirm.isSuccess ? (
        <form
          noValidate
          className="space-y-3"
          onSubmit={confirmForm.handleSubmit(async (body) => {
            await confirm.mutateAsync(body.code);
            setPendingEmail(null);
          })}
        >
          <FormAlert tone="success">{t.profile.emailCodeSent(pendingEmail)}</FormAlert>
          {confirmForm.formError && <FormAlert>{confirmForm.formError}</FormAlert>}
          <TextField
            label={t.fields.code}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            error={confirmForm.errors['code']}
            {...confirmForm.field('code')}
          />
          <SubmitButton pending={confirm.isPending}>{t.profile.confirmEmail}</SubmitButton>
        </form>
      ) : (
        <form
          noValidate
          className="space-y-3"
          onSubmit={requestForm.handleSubmit(async (body) => {
            await request.mutateAsync(body);
            setPendingEmail(body.newEmail);
          })}
        >
          {requestForm.formError && <FormAlert>{requestForm.formError}</FormAlert>}
          <TextField
            label={t.fields.newEmail}
            type="email"
            autoComplete="email"
            error={requestForm.errors['newEmail']}
            {...requestForm.field('newEmail')}
          />
          <SubmitButton pending={request.isPending}>{t.profile.changeEmail}</SubmitButton>
        </form>
      )}
    </section>
  );
}

export function ProfilePage() {
  const profile = useMyProfile();
  if (profile.isPending) return <p role="status">{t.loading}</p>;
  if (profile.isError) return <FormAlert>{t.errors.generic}</FormAlert>;
  return (
    <div className="max-w-xl space-y-8">
      <h1 className="text-2xl font-bold">{t.profile.heading}</h1>
      <ProfileForm profile={profile.data} />
      <EmailChange current={profile.data.email} />
    </div>
  );
}
