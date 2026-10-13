import {
  type AdminService,
  ApprovalModes,
  InPersonSteps,
  SubjectModes,
  UpdateServiceRequestSchema,
} from '@govserve/shared';
import { Link, useNavigate, useParams } from 'react-router';
import {
  useAdminServices,
  useCreateDraft,
  useServiceVersions,
  useUpdateService,
} from '../../api/catalogue';
import { FormAlert, SelectField, SubmitButton, TextField } from '../../components/form';
import { useZodForm } from '../../forms/useZodForm';
import { t } from '../../strings';

const a = t.adminCatalogue;

function ServiceSettings({ service }: { service: AdminService }) {
  const update = useUpdateService(service.id);
  const form = useZodForm(UpdateServiceRequestSchema, {
    name: service.name,
    description: service.description,
    slaWorkingDays: String(service.slaWorkingDays),
    validityMonths: service.validityMonths === null ? '' : String(service.validityMonths),
    inPersonStep: service.inPersonStep,
    approvalMode: service.approvalMode,
    subjectMode: service.subjectMode,
    active: String(service.active),
  });
  return (
    <section aria-labelledby="svc-settings" className="space-y-4">
      <h2 id="svc-settings" className="text-lg font-semibold">
        {a.settingsHeading}
      </h2>
      <p className="text-sm text-slate-600">
        {a.fields.code}: <span className="font-mono">{service.code}</span> ·{' '}
        {a.fields.certificatePrefix}: {service.certificatePrefix} ·{' '}
        {t.departments[service.departmentCode]}
      </p>
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={form.handleSubmit(
          (body) => update.mutateAsync(body),
          (v) => ({
            ...v,
            slaWorkingDays: Number(v['slaWorkingDays']),
            validityMonths: v['validityMonths'] ? Number(v['validityMonths']) : null,
            active: v['active'] === 'true',
          }),
        )}
      >
        <div className="space-y-2 sm:col-span-2">
          {form.formError && <FormAlert>{form.formError}</FormAlert>}
          {update.isSuccess && <FormAlert tone="success">{a.saved}</FormAlert>}
        </div>
        <TextField label={a.fields.name} error={form.errors['name']} {...form.field('name')} />
        <SelectField
          label={a.fields.active}
          options={[
            { value: 'true', label: a.active },
            { value: 'false', label: a.inactive },
          ]}
          {...form.field('active')}
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
          <SubmitButton pending={update.isPending}>{a.save}</SubmitButton>
        </div>
      </form>
    </section>
  );
}

function Versions({ serviceId }: { serviceId: string }) {
  const versions = useServiceVersions(serviceId);
  const createDraft = useCreateDraft(serviceId);
  const navigate = useNavigate();
  const hasDraft = versions.data?.some((v) => v.status === 'DRAFT');
  return (
    <section aria-labelledby="svc-versions" className="space-y-3">
      <h2 id="svc-versions" className="text-lg font-semibold">
        {a.versionsHeading}
      </h2>
      {createDraft.isError && <FormAlert>{createDraft.error.message}</FormAlert>}
      {!hasDraft && (
        <button
          type="button"
          disabled={createDraft.isPending}
          onClick={() =>
            createDraft.mutate(undefined, {
              onSuccess: (v) => void navigate(`/admin/versions/${v.id}`),
            })
          }
          className="rounded-md bg-brand px-4 py-2 font-semibold text-white"
        >
          {a.newDraft}
        </button>
      )}
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-300">
        {versions.data?.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <span>
              v{v.versionNo} · {a.statuses[v.status]}
              {v.feeIsTest && (
                <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                  {a.test}
                </span>
              )}
            </span>
            <Link to={`/admin/versions/${v.id}`} className="text-brand underline">
              {v.status === 'DRAFT' ? a.editDraft : a.view}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AdminServicePage() {
  const { id = '' } = useParams();
  const services = useAdminServices();
  if (services.isPending) return <p role="status">{t.loading}</p>;
  const service = services.data?.find((s) => s.id === id);
  if (!service) return <FormAlert>{t.errors.generic}</FormAlert>;
  return (
    <div className="space-y-8">
      <p>
        <Link to="/admin/services" className="text-brand underline">
          ← {a.heading}
        </Link>
      </p>
      <h1 className="text-2xl font-bold">{service.name}</h1>
      <ServiceSettings service={service} />
      <Versions serviceId={service.id} />
    </div>
  );
}
