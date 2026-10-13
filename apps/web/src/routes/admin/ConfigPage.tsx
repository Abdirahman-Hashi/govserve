import {
  CreateHolidayRequestSchema,
  CreateReasonCodeRequestSchema,
  ReasonCodeKinds,
  type Setting,
  Weekdays,
} from '@govserve/shared';
import { useState } from 'react';
import {
  useAddHoliday,
  useCreateReasonCode,
  useHolidays,
  useReasonCodes,
  useRemoveHoliday,
  useSettings,
  useUpdateReasonCode,
  useUpdateSetting,
} from '../../api/catalogue';
import { ApiError } from '../../api/client';
import { FormAlert, SelectField, SubmitButton, TextField } from '../../components/form';
import { useZodForm } from '../../forms/useZodForm';
import { t } from '../../strings';

const c = t.config;

function SettingRow({ setting }: { setting: Setting }) {
  const update = useUpdateSetting();
  const isWeek = setting.key === 'calendar.workingWeek';
  const [value, setValue] = useState<string | string[]>(
    isWeek ? (setting.value as string[]) : String(setting.value),
  );
  const [error, setError] = useState<string | null>(null);
  const id = `setting-${setting.key.replace(/\W/g, '-')}`;
  const label = c.settingLabels[setting.key] ?? setting.key;

  const save = () => {
    setError(null);
    // Cents travel as strings; every other scalar setting is a number.
    const parsed = isWeek
      ? value
      : setting.key.endsWith('Cents')
        ? String(value).trim()
        : Number(value);
    update.mutate(
      { key: setting.key, value: parsed },
      {
        onError: (err) =>
          setError(
            err instanceof ApiError
              ? (Object.values(err.fieldErrors())[0] ?? err.message)
              : t.errors.generic,
          ),
      },
    );
  };

  return (
    <li className="flex flex-wrap items-end gap-3 border-b border-slate-200 py-3">
      {isWeek ? (
        <fieldset className="flex-1">
          <legend className="text-sm font-medium">{label}</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {Weekdays.map((d) => (
              <label key={d} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={(value as string[]).includes(d)}
                  onChange={(e) =>
                    setValue((v) =>
                      e.target.checked
                        ? [...(v as string[]), d]
                        : (v as string[]).filter((x) => x !== d),
                    )
                  }
                />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <div className="min-w-[12rem] flex-1">
          <label htmlFor={id} className="block text-sm font-medium">
            {label}
          </label>
          <input
            id={id}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-400 px-3 py-2"
          />
        </div>
      )}
      <button
        type="button"
        onClick={save}
        disabled={update.isPending}
        className="rounded-md border border-brand px-3 py-2 text-sm font-semibold text-brand"
      >
        {c.save}
      </button>
      {update.isSuccess && !error && (
        <span role="status" className="text-sm text-green-800">
          ✓ {c.saved}
        </span>
      )}
      {error && (
        <span role="alert" className="w-full text-sm text-red-800">
          ✕ {error}
        </span>
      )}
    </li>
  );
}

function Holidays() {
  const holidays = useHolidays();
  const add = useAddHoliday();
  const remove = useRemoveHoliday();
  const form = useZodForm(CreateHolidayRequestSchema, { date: '', name: '' });
  return (
    <section aria-labelledby="hol-h" className="space-y-3">
      <h2 id="hol-h" className="text-lg font-semibold">
        {c.holidaysHeading}
      </h2>
      <form
        noValidate
        className="flex flex-wrap items-end gap-3"
        onSubmit={form.handleSubmit((body) => add.mutateAsync(body))}
      >
        <TextField label={c.date} type="date" error={form.errors['date']} {...form.field('date')} />
        <TextField label={c.name} error={form.errors['name']} {...form.field('name')} />
        <SubmitButton pending={add.isPending}>{c.addHoliday}</SubmitButton>
      </form>
      {form.formError && <FormAlert>{form.formError}</FormAlert>}
      {holidays.data?.length === 0 && <p>{c.noHolidays}</p>}
      <ul className="divide-y divide-slate-200">
        {holidays.data?.map((h) => (
          <li key={h.date} className="flex items-center justify-between py-2">
            <span>
              {h.date} · {h.name}
            </span>
            <button
              type="button"
              className="text-red-800 underline"
              onClick={() => remove.mutate(h.date)}
              aria-label={`${c.remove}: ${h.name}`}
            >
              {c.remove}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReasonCodes() {
  const codes = useReasonCodes();
  const create = useCreateReasonCode();
  const update = useUpdateReasonCode();
  const form = useZodForm(CreateReasonCodeRequestSchema, { kind: 'REJECT', code: '', label: '' });
  return (
    <section aria-labelledby="rc-h" className="space-y-3">
      <h2 id="rc-h" className="text-lg font-semibold">
        {c.reasonsHeading}
      </h2>
      <form
        noValidate
        className="grid gap-3 sm:grid-cols-4 sm:items-end"
        onSubmit={form.handleSubmit((body) => create.mutateAsync(body))}
      >
        <SelectField
          label={c.kind}
          options={ReasonCodeKinds.map((k) => ({ value: k, label: c.kinds[k] }))}
          {...form.field('kind')}
        />
        <TextField label={c.code} error={form.errors['code']} {...form.field('code')} />
        <TextField label={c.label} error={form.errors['label']} {...form.field('label')} />
        <SubmitButton pending={create.isPending}>{c.addReason}</SubmitButton>
      </form>
      {form.formError && <FormAlert>{form.formError}</FormAlert>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="border-b border-slate-300">
            <tr>
              <th scope="col" className="py-2 pr-4">
                {c.kind}
              </th>
              <th scope="col" className="py-2 pr-4">
                {c.code}
              </th>
              <th scope="col" className="py-2 pr-4">
                {c.label}
              </th>
              <th scope="col" className="py-2 pr-4">
                <span className="sr-only">{c.deactivate}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {codes.data?.map((r) => (
              <tr
                key={r.id}
                className={`border-b border-slate-200 ${r.active ? '' : 'text-slate-500'}`}
              >
                <td className="py-2 pr-4">{c.kinds[r.kind]}</td>
                <td className="py-2 pr-4 font-mono text-xs">{r.code}</td>
                <td className="py-2 pr-4">{r.label}</td>
                <td className="py-2 pr-4">
                  <button
                    type="button"
                    className="underline"
                    onClick={() => update.mutate({ id: r.id, active: !r.active })}
                  >
                    {r.active ? c.deactivate : c.activate}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ConfigPage() {
  const settings = useSettings();
  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold">{c.heading}</h1>
      <section aria-labelledby="set-h">
        <h2 id="set-h" className="text-lg font-semibold">
          {c.settingsHeading}
        </h2>
        {settings.isPending && <p role="status">{t.loading}</p>}
        <ul>
          {settings.data?.map((s) => (
            <SettingRow key={s.key} setting={s} />
          ))}
        </ul>
      </section>
      <Holidays />
      <ReasonCodes />
    </div>
  );
}
