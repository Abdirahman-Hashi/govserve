import {
  ApprovalModes,
  CreateServiceRequestSchema,
  DepartmentCodes,
  InPersonSteps,
  SubjectModes,
} from '@govserve/shared';
import { Link } from 'react-router';
import { useAdminServices, useCreateService } from '../../api/catalogue';
import { FormAlert, SelectField, SubmitButton, TextField } from '../../components/form';
import { useZodForm } from '../../forms/useZodForm';
import { t } from '../../strings';

const a = t.adminCatalogue;

function CreateServiceForm() {
  const create = useCreateService();
  const form = useZodForm(CreateServiceRequestSchema, {
    code: '',
    certificatePrefix: '',
    departmentCode: 'ADDRESS',
    name: '',
    description: '',
    slaWorkingDays: '10',
    inPersonStep: 'NONE',
    approvalMode: 'SINGLE',
    validityMonths: '',
    subjectMode: 'SELF',
  });
  return (
    <details className="rounded-lg border border-slate-300 p-4">
      <summary className="cursor-pointer font-semibold">{a.newService}</summary>
      <form
        noValidate
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={form.handleSubmit(
          (body) => create.mutateAsync(body),
          (v) => ({
            ...v,
            active: false,
            slaWorkingDays: Number(v['slaWorkingDays']),
            validityMonths: v['validityMonths'] ? Number(v['validityMonths']) : null,
          }),
        )}
      >
        <div className="space-y-2 sm:col-span-2">
          {form.formError && <FormAlert>{form.formError}</FormAlert>}
          {create.isSuccess && <FormAlert tone="success">{a.created}</FormAlert>}
        </div>
        <TextField label={a.fields.name} error={form.errors['name']} {...form.field('name')} />
        <TextField
          label={a.fields.code}
          hint="e.g. BUSINESS_PERMIT"
          error={form.errors['code']}
          {...form.field('code')}
        />
        <TextField
          label={a.fields.certificatePrefix}
          hint="2–5 capital letters"
          error={form.errors['certificatePrefix']}
          {...form.field('certificatePrefix')}
        />
        <SelectField
          label={t.fields.department}
          options={DepartmentCodes.map((d) => ({ value: d, label: t.departments[d] }))}
          {...form.field('departmentCode')}
        />
        <div className="sm:col-span-2">
          <TextField
            label={a.fields.description}
            error={form.errors['description']}
            {...form.field('description')}
          />
        </div>
        <TextField
          label={a.fields.slaWorkingDays}
          inputMode="numeric"
          error={form.errors['slaWorkingDays']}
          {...form.field('slaWorkingDays')}
        />
        <TextField
          label={a.fields.validityMonths}
          inputMode="numeric"
          error={form.errors['validityMonths']}
          {...form.field('validityMonths')}
        />
        <SelectField
          label={a.fields.inPersonStep}
          options={InPersonSteps.map((v) => ({ value: v, label: a.inPersonSteps[v] }))}
          {...form.field('inPersonStep')}
        />
        <SelectField
          label={a.fields.approvalMode}
          options={ApprovalModes.map((v) => ({ value: v, label: a.approvalModes[v] }))}
          {...form.field('approvalMode')}
        />
        <SelectField
          label={a.fields.subjectMode}
          options={SubjectModes.map((v) => ({ value: v, label: a.subjectModes[v] }))}
          {...form.field('subjectMode')}
        />
        <div className="sm:col-span-2">
          <SubmitButton pending={create.isPending}>{a.create}</SubmitButton>
        </div>
      </form>
    </details>
  );
}

export function AdminServicesPage() {
  const services = useAdminServices();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{a.heading}</h1>
      <CreateServiceForm />
      {services.isPending && <p role="status">{t.loading}</p>}
      {services.isError && <FormAlert>{t.errors.generic}</FormAlert>}
      {services.data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-slate-300">
              <tr>
                {Object.values(a.columns).map((c) => (
                  <th key={c} scope="col" className="py-2 pr-4">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {services.data.map((s) => (
                <tr key={s.id} className="border-b border-slate-200">
                  <td className="py-2 pr-4">
                    <Link to={`/admin/services/${s.id}`} className="text-brand underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{s.code}</td>
                  <td className="py-2 pr-4">{t.departments[s.departmentCode]}</td>
                  <td className="py-2 pr-4">
                    {s.publishedVersionNo ? `v${s.publishedVersionNo}` : a.none}
                    {s.feeIsTest && (
                      <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                        {a.test}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">{s.active ? a.active : a.inactive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
