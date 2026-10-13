import { type FormValues } from '@govserve/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSaveApplication } from '../../api/applications';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const DELAY_MS = 1500;
const RETRY_MS = 5000;

/**
 * Autosaves changed answers (FR-030) 1.5 s after the user stops typing. Only changed fields
 * are sent; cleared fields are sent as null. Failed saves retry, so nothing typed is lost.
 */
export function useAutosave(applicationId: string, initial: FormValues) {
  const save = useSaveApplication(applicationId);
  // useMutation returns a new object each render; keep it in a ref so `flush` stays stable
  // (otherwise the unmount cleanup below would run, and save, on every render).
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  const [values, setValues] = useState<FormValues>(initial);
  const [state, setState] = useState<SaveState>('idle');
  const dirty = useRef(new Set<string>());
  const latest = useRef(values);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    latest.current = values;
  }, [values]);

  const flush = useCallback(async function run(): Promise<boolean> {
    clearTimeout(timer.current);
    if (dirty.current.size === 0) return true;
    const keys = [...dirty.current];
    dirty.current.clear();
    const formData = Object.fromEntries(keys.map((k) => [k, latest.current[k] ?? null]));
    setState('saving');
    try {
      await saveRef.current.mutateAsync({ formData });
      setState(dirty.current.size > 0 ? 'saving' : 'saved');
      return true;
    } catch {
      keys.forEach((k) => dirty.current.add(k));
      setState('error');
      timer.current = setTimeout(() => void run(), RETRY_MS);
      return false;
    }
  }, []);

  const setField = useCallback(
    (name: string, value: string | number | boolean | undefined) => {
      setValues((v) => {
        const next = { ...v };
        if (value === undefined) delete next[name];
        else next[name] = value;
        return next;
      });
      dirty.current.add(name);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), DELAY_MS);
    },
    [flush],
  );

  // Save what is pending when leaving the page.
  useEffect(() => () => void flush(), [flush]);

  return { values, setField, state, flush };
}
