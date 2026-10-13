import { type FormValues, type RequiredDocument, validateFormData } from '@govserve/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useCatalogueService } from '../../api/catalogue';
import { useAuth } from '../../auth/AuthProvider';
import { DynamicForm } from '../../components/DynamicForm';
import { FeeEstimate } from '../../components/FeeEstimate';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
};

function DocumentList({ docs }: { docs: RequiredDocument[] }) {
  const singles = docs.filter((d) => !d.oneOfGroup);
  const groups = new Map<string, RequiredDocument[]>();
  for (const d of docs)
    if (d.oneOfGroup) groups.set(d.oneOfGroup, [...(groups.get(d.oneOfGroup) ?? []), d]);
  const describe = (d: RequiredDocument) =>
    t.catalogue.fileTypes(
      d.mime.map((m) => MIME_LABELS[m] ?? m).join(', '),
      Math.round(d.maxBytes / 1048576),
    );
  return (
    <ul className="list-disc space-y-2 pl-5">
      {singles.map((d) => (
        <li key={d.type}>
          <span className="font-medium">{d.label}</span>{' '}
          {!d.required && <span className="text-slate-600">{t.catalogue.optionalDoc}</span>}
          <span className="block text-sm text-slate-600">
            {d.description ? `${d.description} ` : ''}
            {describe(d)}
          </span>
        </li>
      ))}
      {[...groups.entries()].map(([group, members]) => (
        <li key={group}>
          <span className="font-medium">{t.catalogue.anyOneOf}</span>
          <ul className="list-[circle] pl-5">
            {members.map((d) => (
              <li key={d.type}>{d.label}</li>
            ))}
          </ul>
          <span className="block text-sm text-slate-600">{members[0] && describe(members[0])}</span>
        </li>
      ))}
    </ul>
  );
}

export function ServiceDetailPage() {
  const { code = '' } = useParams();
  const service = useCatalogueService(code);
  const auth = useAuth();
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);

  if (service.isPending) return <p role="status">{t.loading}</p>;
  if (service.isError) return <FormAlert>{t.errors.generic}</FormAlert>;
  const s = service.data;

  const onChange = (name: string, value: string | number | boolean | undefined) => {
    setChecked(false);
    setValues((v) => {
      const next = { ...v };
      if (value === undefined) delete next[name];
      else next[name] = value;
      return next;
    });
  };
  const check = () => {
    const result = validateFormData(s.formSchema, values);
    setErrors(result.ok ? {} : result.errors);
    setChecked(result.ok);
  };

  return (
    <div className="space-y-8">
      <p>
        <Link to="/services" className="text-brand underline">
          ← {t.catalogue.back}
        </Link>
      </p>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{s.name}</h1>
        <p className="max-w-prose text-slate-700">{s.description}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="needs" className="space-y-4">
          <h2 id="needs" className="text-lg font-semibold">
            {t.catalogue.requirementsHeading}
          </h2>
          <ul className="space-y-1 text-sm">
            <li>
              <span className="font-medium">{t.catalogue.processing}:</span>{' '}
              {t.catalogue.days(s.slaWorkingDays)}
            </li>
            <li>{t.catalogue.validity(s.validityMonths)}</li>
            <li>{t.catalogue.inPerson[s.inPersonStep]}</li>
          </ul>
          <h3 className="font-semibold">{t.catalogue.documentsHeading}</h3>
          <DocumentList docs={s.requiredDocuments} />
        </section>
        <FeeEstimate fee={s.fee} provisional={s.feeProvisional} />
      </div>
      <section aria-labelledby="form-preview" className="max-w-xl space-y-4">
        <h2 id="form-preview" className="text-lg font-semibold">
          {t.catalogue.formHeading}
        </h2>
        <DynamicForm
          schema={s.formSchema}
          ui={s.uiSchema}
          values={values}
          onChange={onChange}
          errors={errors}
          idPrefix="preview"
        />
        <button
          type="button"
          onClick={check}
          className="rounded-md border border-brand px-4 py-2 font-semibold text-brand"
        >
          {t.catalogue.checkAnswers}
        </button>
        {checked && <FormAlert tone="success">{t.catalogue.answersOk}</FormAlert>}
        <p className="text-sm text-slate-700">
          {t.catalogue.applySoon}{' '}
          {auth.status === 'anonymous' && (
            <Link to="/register" className="text-brand underline">
              {t.catalogue.signInToApply}
            </Link>
          )}
        </p>
      </section>
    </div>
  );
}
