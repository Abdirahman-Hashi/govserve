import { type FormEvent, useState } from 'react';
import { type z } from 'zod';
import { ApiError } from '../api/client';

type Values = Record<string, string>;

/**
 * Small form helper: validates with the same shared Zod schema the API uses (frontend rule),
 * and maps 422 field details from the API back onto the fields.
 */
export function useZodForm<S extends z.ZodType>(schema: S, initial: Values) {
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const field = (name: string) => ({
    name,
    id: name,
    value: values[name] ?? '',
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [name]: e.target.value })),
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
  });

  const handleSubmit =
    (submit: (data: z.infer<S>) => Promise<unknown>, toBody?: (v: Values) => unknown) =>
    (e: FormEvent) => {
      e.preventDefault();
      setFormError(null);
      const parsed = schema.safeParse(toBody ? toBody(values) : values);
      if (!parsed.success) {
        const next: Record<string, string> = {};
        for (const issue of parsed.error.issues) next[issue.path.join('.')] ??= issue.message;
        setErrors(next);
        return;
      }
      setErrors({});
      submit(parsed.data).catch((err: unknown) => {
        if (err instanceof ApiError) {
          setErrors(err.fieldErrors());
          setFormError(err.message);
        } else {
          setFormError('Something went wrong. Please try again.');
        }
      });
    };

  return { values, setValues, errors, formError, setFormError, field, handleSubmit };
}
