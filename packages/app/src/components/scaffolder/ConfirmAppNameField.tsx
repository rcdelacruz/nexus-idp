/**
 * ConfirmAppNameField — custom scaffolder field extension.
 *
 * Blocks submission until the user types the exact repo name — the real
 * teardown scope (a repo can back multiple Components, e.g. -frontend and
 * -backend sharing one repo/namespace/database) — not the entity's own name.
 * Confirming against the entity name would give false confidence: it proves
 * "I meant to click teardown here," not "I understand everything this
 * deletes." Falls back to the entity name only if repoName couldn't be
 * resolved client-side (entity has neither project-slug nor source-location
 * annotations). Used by teardown-app as the last line of defense before an
 * irreversible delete — see .claude/plans/teardown-application-plan.md EC-11.
 *
 * Usage in template.yaml:
 *   confirmation:
 *     title: Type the repository name to confirm
 *     type: string
 *     ui:field: ConfirmAppNameField
 */
import React, { useState } from 'react';
import { CustomFieldValidator, FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import { TextField } from '@material-ui/core';

function appNameFromEntityRef(entityRef: unknown): string {
  if (typeof entityRef !== 'string') return '';
  const nameSegment = entityRef.split('/').pop() ?? '';
  return nameSegment;
}

/**
 * repoName is read directly from sessionStorage, NOT routed through a second
 * RJSF field. Two independent self-populating fields in the same form step
 * (this + TeardownEntityRefField) each firing their own onChange on mount is
 * a real race in RJSF's controlled-form model — one can silently overwrite
 * the other's update to formState, leaving a required field empty and
 * blocking Next. repoName never needs to be a submitted scaffolder
 * parameter (discover-resources already computes it server-side); it's only
 * used here for the confirmation comparison, so reading it directly
 * sidesteps the race entirely.
 */
function expectedConfirmation(formData: any): string {
  const repoName = typeof window !== 'undefined' ? sessionStorage.getItem('teardown-repoName') : null;
  if (repoName) return repoName;
  return appNameFromEntityRef(formData?.entityRef);
}

export const ConfirmAppNameField = ({
  onChange,
  formData,
  required,
  formContext,
}: FieldExtensionComponentProps<string>) => {
  const [touched, setTouched] = useState(false);
  const expected = expectedConfirmation((formContext as any)?.formData);

  const value = formData ?? '';
  const mismatch = touched && value !== '' && value !== expected;

  let helperText: string;
  if (mismatch) {
    helperText = `Does not match "${expected}"`;
  } else if (expected) {
    helperText = `Type "${expected}" to confirm`;
  } else {
    helperText = 'Select an application first';
  }

  return (
    <TextField
      required={required}
      value={value}
      onChange={e => {
        setTouched(true);
        onChange(e.target.value);
      }}
      error={mismatch}
      helperText={helperText}
      fullWidth
    />
  );
};

/** Blocks form progression until the typed value matches the actual teardown scope (repoName). */
export const validateConfirmAppName: CustomFieldValidator<string> = (data, field, context) => {
  const expected = expectedConfirmation(context.formData as any);
  if (!expected || data !== expected) {
    field.addError(`Must match the application name exactly ("${expected}")`);
  }
};
