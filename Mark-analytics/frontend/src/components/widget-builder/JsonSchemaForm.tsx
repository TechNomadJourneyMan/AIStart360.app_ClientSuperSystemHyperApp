import { useCallback } from 'react';
import { X } from 'lucide-react';
import type { JsonSchema, JsonSchemaProperty } from '@/types/widgets';

/**
 * A tiny JSON-Schema-driven form. Pulling in `react-jsonschema-form` for our
 * 6 schemas would be ~200KB+ — overkill. This implementation supports the
 * subset our catalog actually uses:
 *
 *   - `type: 'string'`   → text input (or textarea via `format: 'textarea'`)
 *   - `type: 'string' + enum`  → <select>
 *   - `type: 'number' | 'integer'` → number input
 *   - `type: 'boolean'`  → checkbox
 *   - `type: 'array' items.type === 'string'` → tag input (Enter / comma to add)
 *
 * Constraints: keep this file under ~200 lines.
 */

export interface JsonSchemaFormProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

const LABEL_CLS =
  'mb-1 block text-[11px] font-medium uppercase tracking-wider text-neutral-600 dark:text-neutral-400';
const INPUT_CLS =
  'w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 focus:border-indigo-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100';

export function JsonSchemaForm({ schema, value, onChange }: JsonSchemaFormProps): JSX.Element {
  const setField = useCallback(
    (key: string, v: unknown) => onChange({ ...value, [key]: v }),
    [onChange, value],
  );

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
      {Object.entries(schema.properties).map(([key, prop]) => (
        <Field
          key={key}
          name={key}
          prop={prop}
          required={schema.required?.includes(key) ?? false}
          value={value[key]}
          onChange={(v) => setField(key, v)}
        />
      ))}
    </form>
  );
}

interface FieldProps {
  name: string;
  prop: JsonSchemaProperty;
  required: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
}

function Field({ name, prop, required, value, onChange }: FieldProps): JSX.Element {
  const label = (
    <label htmlFor={`field_${name}`} className={LABEL_CLS}>
      {prop.title ?? name}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  );

  // Enum → select
  if (prop.type === 'string' && prop.enum) {
    return (
      <div>
        {label}
        <select
          id={`field_${name}`}
          value={typeof value === 'string' ? value : (prop.default as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLS}
        >
          {prop.enum.map((opt) => {
            const k = String(opt);
            const lbl = prop.enumLabels?.[k] ?? k;
            return (
              <option key={k} value={k}>
                {lbl}
              </option>
            );
          })}
        </select>
      </div>
    );
  }

  // Textarea / text
  if (prop.type === 'string') {
    const isTextarea = prop.format === 'textarea';
    const v = typeof value === 'string' ? value : (prop.default as string) ?? '';
    return (
      <div>
        {label}
        {isTextarea ? (
          <textarea
            id={`field_${name}`}
            value={v}
            placeholder={prop.placeholder}
            onChange={(e) => onChange(e.target.value)}
            rows={5}
            className={`${INPUT_CLS} font-mono`}
          />
        ) : (
          <input
            id={`field_${name}`}
            type="text"
            value={v}
            placeholder={prop.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={INPUT_CLS}
          />
        )}
        {prop.description && (
          <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">{prop.description}</p>
        )}
      </div>
    );
  }

  if (prop.type === 'number' || prop.type === 'integer') {
    const v = typeof value === 'number' ? value : (prop.default as number) ?? 0;
    return (
      <div>
        {label}
        <input
          id={`field_${name}`}
          type="number"
          value={v}
          min={prop.minimum}
          max={prop.maximum}
          step={prop.type === 'integer' ? 1 : 'any'}
          onChange={(e) => {
            const n = e.target.value === '' ? 0 : Number(e.target.value);
            onChange(prop.type === 'integer' ? Math.trunc(n) : n);
          }}
          className={INPUT_CLS}
        />
      </div>
    );
  }

  if (prop.type === 'boolean') {
    const v = typeof value === 'boolean' ? value : Boolean(prop.default);
    return (
      <div className="flex items-center gap-2">
        <input
          id={`field_${name}`}
          type="checkbox"
          checked={v}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
        />
        <label htmlFor={`field_${name}`} className="text-sm text-neutral-700 dark:text-neutral-300">
          {prop.title ?? name}
        </label>
      </div>
    );
  }

  if (prop.type === 'array' && prop.items?.type === 'string') {
    const arr = Array.isArray(value) ? (value as string[]) : ((prop.default as string[]) ?? []);
    return (
      <div>
        {label}
        <TagInput value={arr} onChange={(v) => onChange(v)} />
      </div>
    );
  }

  // Fallback for unsupported shapes — surface so it can be fixed in the schema.
  return (
    <div className="text-[10px] text-amber-700">
      Unsupported field "{name}" (type {String(prop.type)})
    </div>
  );
}

function TagInput({
  value,
  onChange,
}: {
  value: readonly string[];
  onChange: (v: string[]) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded border border-neutral-300 bg-white p-1 dark:border-neutral-700 dark:bg-neutral-950">
      {value.map((tag, i) => (
        <span
          key={`${tag}_${i}`}
          className="flex items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="hover:text-indigo-900 dark:hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        placeholder="Add tag…"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const v = e.currentTarget.value.trim();
            if (v) {
              onChange([...value, v]);
              e.currentTarget.value = '';
            }
          } else if (e.key === 'Backspace' && e.currentTarget.value === '' && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        className="flex-1 min-w-[80px] bg-transparent px-1 py-0.5 text-xs text-neutral-900 outline-none dark:text-neutral-100"
      />
    </div>
  );
}

export default JsonSchemaForm;
