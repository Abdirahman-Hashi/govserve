import {
  DepartmentCodes,
  InviteStaffRequestSchema,
  StaffRoles,
  type StaffMember,
} from '@govserve/shared';
import { useState } from 'react';
import { useDeactivateStaff, useInviteStaff, useStaff } from '../../api/staff';
import { useAuth } from '../../auth/AuthProvider';
import { FormAlert, SelectField, SubmitButton, TextField } from '../../components/form';
import { useZodForm } from '../../forms/useZodForm';
import { t } from '../../strings';

function InviteForm() {
  const invite = useInviteStaff();
  const form = useZodForm(InviteStaffRequestSchema, {
    email: '',
    fullName: '',
    role: 'OFFICER',
    departmentCode: 'ADDRESS',
  });
  const isAdminRole = form.values['role'] === 'ADMIN';

  return (
    <section aria-labelledby="invite-heading" className="space-y-3">
      <h2 id="invite-heading" className="text-lg font-semibold">
        {t.staff.inviteHeading}
      </h2>
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={form.handleSubmit(
          async (body) => {
            await invite.mutateAsync(body);
            form.setValues((v) => ({ ...v, email: '', fullName: '' }));
          },
          (v) => ({ ...v, departmentCode: v['role'] === 'ADMIN' ? null : v['departmentCode'] }),
        )}
      >
        <div className="sm:col-span-2 space-y-2">
          {form.formError && <FormAlert>{form.formError}</FormAlert>}
          {invite.isSuccess && (
            <FormAlert tone="success">{t.staff.invited(invite.data.email)}</FormAlert>
          )}
        </div>
        <TextField
          label={t.fields.fullName}
          error={form.errors['fullName']}
          {...form.field('fullName')}
        />
        <TextField
          label={t.fields.email}
          type="email"
          error={form.errors['email']}
          {...form.field('email')}
        />
        <SelectField
          label={t.fields.role}
          options={StaffRoles.map((r) => ({ value: r, label: t.roles[r] }))}
          error={form.errors['role']}
          {...form.field('role')}
        />
        {!isAdminRole && (
          <SelectField
            label={t.fields.department}
            options={DepartmentCodes.map((d) => ({ value: d, label: t.departments[d] }))}
            error={form.errors['departmentCode']}
            {...form.field('departmentCode')}
          />
        )}
        <div className="sm:col-span-2">
          <SubmitButton pending={invite.isPending}>{t.staff.invite}</SubmitButton>
        </div>
      </form>
    </section>
  );
}

function DeactivateButton({ member }: { member: StaffMember }) {
  const deactivate = useDeactivateStaff();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className="text-red-800 underline" onClick={() => setConfirming(true)}>
        {t.staff.deactivate}
      </button>
    );
  }
  return (
    <div role="group" aria-label={t.staff.confirmDeactivate(member.fullName)} className="space-y-1">
      <p className="text-sm">{t.staff.confirmDeactivate(member.fullName)}</p>
      <div className="flex gap-3">
        <button
          type="button"
          className="font-semibold text-red-800 underline"
          disabled={deactivate.isPending}
          onClick={() => deactivate.mutate(member.id)}
        >
          {t.staff.confirm}
        </button>
        <button type="button" className="underline" onClick={() => setConfirming(false)}>
          {t.staff.cancel}
        </button>
      </div>
    </div>
  );
}

export function StaffPage() {
  const staff = useStaff();
  const auth = useAuth();
  const selfId = auth.status === 'authenticated' ? auth.user.id : null;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">{t.staff.heading}</h1>
      <InviteForm />
      {staff.isPending && <p role="status">{t.loading}</p>}
      {staff.isError && <FormAlert>{t.errors.generic}</FormAlert>}
      {staff.data && staff.data.length === 0 && <p>{t.staff.empty}</p>}
      {staff.data && staff.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-slate-300">
              <tr>
                {Object.values(t.staff.columns).map((c) => (
                  <th key={c} scope="col" className="py-2 pr-4 font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.data.map((m) => (
                <tr key={m.id} className="border-b border-slate-200 align-top">
                  <td className="py-2 pr-4">{m.fullName}</td>
                  <td className="py-2 pr-4">{m.email}</td>
                  <td className="py-2 pr-4">{t.roles[m.role]}</td>
                  <td className="py-2 pr-4">
                    {m.departmentCode ? t.departments[m.departmentCode] : t.staff.none}
                  </td>
                  <td className="py-2 pr-4">{t.statuses[m.status]}</td>
                  <td className="py-2 pr-4">
                    {m.status !== 'DEACTIVATED' && m.id !== selfId && (
                      <DeactivateButton member={m} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
