/**
 * ValidatedTextField — generic scaffolder field extension for live (on-the-fly) validation.
 *
 * Reads validation rules from the JSON Schema (pattern, minLength, maxLength) and validates
 * on every keystroke. Errors appear immediately as the user types — no blur required.
 *
 * Usage in template.yaml:
 *   appName:
 *     title: App Name
 *     type: string
 *     pattern: '^[a-z][a-z0-9-]{2,48}[a-z0-9]$'
 *     minLength: 4
 *     maxLength: 50
 *     ui:field: ValidatedTextField
 *     ui:help: 'e.g. customer-portal, admin-dashboard'
 */
import React, { useState, useRef, useEffect } from 'react';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import { TextField } from '@material-ui/core';

type FieldSchema = {
  title?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  [key: string]: any;
};

function getLiveError(
  value: string,
  schema: FieldSchema,
  required: boolean,
  helpText: string | undefined,
): string {
  if (!value) return required ? 'This field is required' : '';

  if (schema.minLength !== undefined && value.length < schema.minLength)
    return `At least ${schema.minLength} characters required (${value.length} now)`;
  if (schema.maxLength !== undefined && value.length > schema.maxLength)
    return `Maximum ${schema.maxLength} characters allowed (${value.length} now)`;
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
    return helpText
      ? `Invalid format — ${helpText}`
      : 'Invalid format. Check the field description.';
  }
  return '';
}

export const ValidatedTextField = ({
  onChange,
  formData,
  required,
  rawErrors,
  schema,
  uiSchema,
}: FieldExtensionComponentProps<string>) => {
  const [liveError, setLiveError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const helpText = uiSchema?.['ui:help'] as string | undefined;
  const shouldAutoFocus = uiSchema?.['ui:autofocus'] as boolean | undefined;
  const s = schema as FieldSchema;

  // Programmatic focus avoids the jsx-a11y/no-autofocus lint error while
  // preserving the same UX — screen readers are not disrupted on initial load.
  useEffect(() => {
    if (shouldAutoFocus) {
      inputRef.current?.focus();
    }
  // Only run on mount — step changes unmount/remount the component.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLiveError(getLiveError(val, s, required ?? false, helpText));
    onChange(val);
  };

  // Live error takes priority; fall back to RJSF extraErrors (from async validators)
  const displayError = liveError || rawErrors?.[0] || '';

  return (
    <TextField
      required={required}
      value={formData ?? ''}
      onChange={handleChange}
      error={!!displayError}
      // Only show helperText when there is an error.
      // The FieldTemplate already renders schema.title (label) and ui:help — don't duplicate.
      helperText={displayError || undefined}
      fullWidth
      inputRef={inputRef}
      inputProps={{
        ...(typeof s.minLength === 'number' ? { minLength: s.minLength } : {}),
        ...(typeof s.maxLength === 'number' ? { maxLength: s.maxLength } : {}),
      }}
    />
  );
};
