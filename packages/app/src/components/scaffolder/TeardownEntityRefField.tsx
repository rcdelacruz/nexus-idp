/**
 * TeardownEntityRefField — custom scaffolder field extension.
 *
 * Reads the entityRef DangerZoneCard hands off before navigating here.
 * sessionStorage is the primary channel — the query string was observed to
 * be gone by the time this field mounts (the wizard route re-renders/
 * remounts between navigation and field mount), so window.location.search
 * is kept only as a fallback, not relied on. There is no supported way to
 * pre-fill scaffolder form data via router state in this Backstage version.
 *
 * Renders visible feedback rather than nothing — an invisible required field
 * left the "Application" step looking blank/broken, especially when the
 * template was opened directly (no handoff at all) instead of via the
 * entity page's Danger Zone button.
 *
 * Usage in template.yaml:
 *   entityRef:
 *     title: Application
 *     type: string
 *     ui:field: TeardownEntityRefField
 */
import React, { useEffect, useState } from 'react';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';

export const TeardownEntityRefField = ({
  onChange,
  formData,
}: FieldExtensionComponentProps<string>) => {
  const [entityRef, setEntityRef] = useState<string | null>(formData ?? null);

  useEffect(() => {
    // Already set (e.g. field remounted after navigating Back then Next
    // through the wizard) — keep it, don't re-derive from sessionStorage,
    // which is cleared after its first read.
    if (formData) {
      setEntityRef(formData);
      return;
    }
    const fromSession = sessionStorage.getItem('teardown-entityRef');
    const fromQuery = new URLSearchParams(window.location.search).get('entityRef');
    const value = fromSession ?? fromQuery;
    sessionStorage.removeItem('teardown-entityRef');
    setEntityRef(value);
    onChange(value ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (entityRef) {
    return (
      <div style={{
        padding: '12px 16px',
        border: '1px solid var(--border, #333)',
        borderRadius: 8,
        fontSize: '0.875rem',
      }}>
        Tearing down: <strong>{entityRef}</strong>
      </div>
    );
  }

  return (
    <div style={{
      padding: '12px 16px',
      border: '1px solid #e5484d',
      borderRadius: 8,
      fontSize: '0.875rem',
      color: '#e5484d',
    }}>
      No application selected. Open this template from the "Teardown Application"
      button on the entity's catalog page — this form can't run without it.
    </div>
  );
};
