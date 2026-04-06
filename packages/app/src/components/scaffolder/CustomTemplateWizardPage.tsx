/**
 * Custom Scaffolder Wizard — Geist design, identical to ProjectRegistrationPage.
 *
 * Custom step circles, Geist cards, useColors(), same buttons, same review.
 * Does NOT use the default Workflow/Stepper — renders RJSF Form directly.
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import useAsync from 'react-use/lib/useAsync';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { useRouteRef, useApi, useApiHolder, errorApiRef } from '@backstage/core-plugin-api';
import { Page, Header, Content, Progress } from '@backstage/core-components';
import { useTemplateSecrets, scaffolderApiRef } from '@backstage/plugin-scaffolder-react';
import {
  Form,
  useTemplateParameterSchema,
  useTemplateSchema,
  createAsyncValidators,
} from '@backstage/plugin-scaffolder-react/alpha';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { rootRouteRef } from '@backstage/plugin-scaffolder';
import { customizeValidator } from '@rjsf/validator-ajv8';
import { Box, Button, Typography } from '@material-ui/core';
import { CheckCircle, FileText, Eye, Loader } from 'lucide-react';
import { useColors, semantic } from '@stratpoint/theme-utils';

import type { TemplateWizardPageProps } from '@backstage/plugin-scaffolder/alpha';

const validator = customizeValidator();

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^\w/, ch => ch.toUpperCase()).trim();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ') || '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

// ── Shared Geist styles ───────────────────────────────────────────────────────

function useGeistStyles() {
  const c = useColors();
  const card = {
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    padding: '20px 24px',
  } as const;

  const sectionLabel: React.CSSProperties = {
    fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: c.textMuted, marginBottom: 12,
  };

  const reviewRow: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '10px 0', borderBottom: `1px solid ${c.border}`,
  };

  const reviewLabel: React.CSSProperties = {
    fontSize: '0.8125rem', color: c.textMuted, fontWeight: 500, minWidth: 160, flexShrink: 0,
  };

  const reviewValue: React.CSSProperties = {
    fontSize: '0.875rem', color: c.text, textAlign: 'right', wordBreak: 'break-word', maxWidth: 400,
  };

  return { c, card, sectionLabel, reviewRow, reviewLabel, reviewValue };
}

// ── Main Component ────────────────────────────────────────────────────────────

export const CustomTemplateWizardPage = (props: TemplateWizardPageProps) => {
  const { c, card, sectionLabel, reviewRow, reviewLabel, reviewValue } = useGeistStyles();
  const navigate = useNavigate();
  const rootRef = useRouteRef(rootRouteRef);
  const { secrets: contextSecrets } = useTemplateSecrets();
  const scaffolderApi = useApi(scaffolderApiRef);
  const catalogApi = useApi(catalogApiRef);
  const errorApi = useApi(errorApiRef);
  const apiHolder = useApiHolder();

  const routeParams = useParams();
  const templateName = routeParams.templateName ?? '';
  const namespace = routeParams.namespace ?? 'default';

  const templateRef = stringifyEntityRef({ kind: 'Template', namespace, name: templateName });

  const { loading, manifest, error } = useTemplateParameterSchema(templateRef);
  const emptyManifest = { title: '', steps: [], EXPERIMENTAL_recovery: undefined as any };
  const { steps } = useTemplateSchema(manifest ?? emptyManifest);

  useAsync(async () => {
    await catalogApi.getEntityByRef(templateRef);
  }, [templateRef, catalogApi]);

  // ── Form state ────────────────────────────────────────────────────────────

  const [activeStep, setActiveStep] = useState(0);
  const [formState, setFormState] = useState<Record<string, any>>({});
  const [isValidating, setIsValidating] = useState(false);
  const [formErrors, setFormErrors] = useState<any>();
  const [isCreating, setIsCreating] = useState(false);

  const totalFormSteps = steps.length;
  const isReviewStep = activeStep === totalFormSteps;
  const allStepLabels = [...steps.map((s, i) => s.title || String(s.schema.title || `Step ${i + 1}`)), 'Review'];

  // Check if required fields for the current step are empty
  const hasRequiredEmpty = useMemo(() => {
    if (activeStep >= totalFormSteps) return false;
    const schema = steps[activeStep]?.schema;
    const required = (schema as any)?.required as string[] | undefined;
    if (!required || required.length === 0) return false;
    return required.some(field => {
      const val = formState[field];
      return val === undefined || val === null || val === '';
    });
  }, [activeStep, totalFormSteps, steps, formState]);

  // Field extensions
  const fields = useMemo(
    () => Object.fromEntries(props.customFieldExtensions.map(({ name, component }) => [name, component])),
    [props.customFieldExtensions],
  );
  const validators = useMemo(
    () => Object.fromEntries(props.customFieldExtensions.map(({ name, validation }) => [name, validation])),
    [props.customFieldExtensions],
  );

  const asyncValidation = useMemo(
    () => activeStep < totalFormSteps
      ? createAsyncValidators(steps[activeStep]?.mergedSchema, validators, { apiHolder })
      : async () => ({}),
    [steps, activeStep, totalFormSteps, validators, apiHolder],
  );

  useEffect(() => {
    if (error) errorApi.post(new Error(`Failed to load template: ${error}`));
  }, [error, errorApi]);

  // Scroll to top on step change
  useEffect(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeStep]);

  const handleBack = useCallback(() => setActiveStep(s => s - 1), []);

  const handleNext = useCallback(async ({ formData = {} }: { formData?: Record<string, any> }) => {
    setFormErrors(undefined);
    setIsValidating(true);
    const returnedValidation = await asyncValidation(formData);
    setFormState(prev => ({ ...prev, ...formData }));
    setIsValidating(false);

    const hasErrs = Object.values(returnedValidation).some((v: any) =>
      v?.__errors?.length > 0 || (typeof v === 'object' && Object.keys(v).length > 0 && v.__errors === undefined),
    );
    if (hasErrs) {
      setFormErrors(returnedValidation);
    } else {
      setFormErrors(undefined);
      setActiveStep(s => s + 1);
    }
  }, [asyncValidation]);

  const handleCreate = useCallback(async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const { taskId } = await scaffolderApi.scaffold({
        templateRef,
        values: formState,
        secrets: contextSecrets,
      });
      navigate(`/create/tasks/${taskId}`);
    } catch (e: any) {
      setIsCreating(false);
      errorApi.post(e);
    }
  }, [isCreating, scaffolderApi, templateRef, formState, contextSecrets, navigate, errorApi]);

  const onError = useCallback(() => <Navigate to={rootRef()} />, [rootRef]);

  if (error) return onError();

  // ── Review renderer — same as ProjectRegistrationPage ───────────────────

  const renderReview = () => {
    const entries = Object.entries(formState).filter(([, v]) => v !== undefined && v !== null && v !== '');

    function resolveTitle(key: string): string {
      for (const step of steps) {
        const p = (step.mergedSchema as any)?.properties;
        if (p?.[key]?.title) return p[key].title;
      }
      return formatKey(key);
    }

    return (
      <Box style={card}>
        <Typography style={sectionLabel}>Review &amp; Create</Typography>
        <Typography style={{ fontSize: '0.8125rem', color: c.textSecondary, marginBottom: 16 }}>
          Review the values below. Use Back to make changes before creating.
        </Typography>
        {entries.map(([key, value], idx) => {
          const title = resolveTitle(key);
          const isLast = idx === entries.length - 1;
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            const subEntries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null && v !== '');
            if (subEntries.length === 0) return null;
            return (
              <React.Fragment key={key}>
                <Typography style={{ ...sectionLabel, marginTop: 16, marginBottom: 8 }}>{title}</Typography>
                {subEntries.map(([subKey, subValue], si) => (
                  <div key={`${key}.${subKey}`} style={{ ...reviewRow, ...(si === subEntries.length - 1 && isLast ? { borderBottom: 'none' } : {}) }}>
                    <span style={reviewLabel}>{formatKey(subKey)}</span>
                    <span style={reviewValue}>{formatValue(subValue)}</span>
                  </div>
                ))}
              </React.Fragment>
            );
          }
          return (
            <div key={key} style={{ ...reviewRow, ...(isLast ? { borderBottom: 'none' } : {}) }}>
              <span style={reviewLabel}>{title}</span>
              <span style={reviewValue}>{formatValue(value)}</span>
            </div>
          );
        })}
      </Box>
    );
  };

  // ── Step indicator — exact same as ProjectRegistrationPage ──────────────

  const renderStepIndicator = () => (
    <Box display="flex" alignItems="flex-start" style={{ marginBottom: 24 }}>
      {allStepLabels.map((label, idx) => {
        const isDone = idx < activeStep;
        const isActive = idx === activeStep;
        const StepIcon = idx === allStepLabels.length - 1 ? Eye : FileText;

        let stepBg = 'transparent';
        if (isDone) stepBg = semantic.successBg;
        else if (isActive) stepBg = c.surface;

        let stepBorder = c.border;
        if (isDone) stepBorder = semantic.success;
        else if (isActive) stepBorder = c.blue;

        let stepColor = c.textMuted;
        if (isDone) stepColor = c.textSecondary;
        else if (isActive) stepColor = c.text;

        return (
          <React.Fragment key={label}>
            <Box display="flex" flexDirection="column" alignItems="center" style={{ flex: 0, minWidth: 60 }}>
              <Box
                display="flex" alignItems="center" justifyContent="center"
                style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                  background: stepBg,
                  border: `2px solid ${stepBorder}`,
                }}
              >
                {isDone
                  ? <CheckCircle size={16} color={semantic.success} strokeWidth={2} />
                  : <StepIcon size={14} strokeWidth={1.5} color={isActive ? c.blue : c.textMuted} />
                }
              </Box>
              <Typography style={{
                fontSize: '0.75rem',
                fontWeight: isActive ? 600 : 500,
                color: stepColor,
                marginTop: 6,
                textAlign: 'center',
                lineHeight: 1.3,
                maxWidth: 100,
              }}>
                {label}
              </Typography>
            </Box>
            {idx < allStepLabels.length - 1 && (
              <Box style={{
                flex: 1, height: 2, minWidth: 16, marginTop: 15,
                background: isDone ? `${semantic.success}33` : c.border,
                borderRadius: 1,
              }} />
            )}
          </React.Fragment>
        );
      })}
    </Box>
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Page themeId="tool">
      <Header
        title={manifest?.title ?? 'Create a new component'}
        subtitle="Fill in the template parameters"
      />
      <Content>
        <Box style={{ maxWidth: 960, width: '100%', margin: '0 auto' }}>
          {loading && <Progress />}

          {manifest && (
            <>
              {isValidating && <Progress />}

              {renderStepIndicator()}

              {/* Form steps — RJSF form inside Geist card, buttons outside */}
              {!isReviewStep && activeStep < totalFormSteps && (
                <>
                  <Box style={card}>
                    <Typography style={sectionLabel}>
                      {steps[activeStep]?.title || String(steps[activeStep]?.schema.title || `Step ${activeStep + 1}`)}
                    </Typography>
                    <Form
                      id="scaffolder-form"
                      validator={validator}
                      extraErrors={formErrors}
                      formData={formState}
                      formContext={{ formData: formState }}
                      schema={steps[activeStep].schema}
                      uiSchema={steps[activeStep].uiSchema}
                      onSubmit={handleNext}
                      fields={fields}
                      showErrorList={false}
                      onChange={(e: any) => setFormState(prev => ({ ...prev, ...e.formData }))}
                      experimental_defaultFormStateBehavior={{ allOf: 'populateDefaults' }}
                      noValidate
                      {...props.formProps}
                    >
                      {/* Hidden submit — real buttons are outside the card */}
                      <button type="submit" style={{ display: 'none' }} />
                    </Form>
                  </Box>
                  <Box display="flex" justifyContent="space-between" style={{ marginTop: 20 }}>
                    <Button
                      variant="outlined" size="small"
                      disabled={activeStep === 0 || isValidating}
                      onClick={handleBack}
                    >
                      Back
                    </Button>
                    <Button
                      variant="contained" color="primary" size="small"
                      disabled={isValidating || hasRequiredEmpty}
                      onClick={() => {
                        const form = document.getElementById('scaffolder-form') as HTMLFormElement | null;
                        form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                      }}
                    >
                      {activeStep === totalFormSteps - 1 ? 'Review' : 'Next'}
                    </Button>
                  </Box>
                </>
              )}

              {/* Review step */}
              {isReviewStep && (
                <>
                  {renderReview()}
                  <Box display="flex" justifyContent="space-between" style={{ marginTop: 20 }}>
                    <Button variant="outlined" size="small" disabled={isCreating} onClick={handleBack}>
                      Back
                    </Button>
                    <Button
                      variant="contained" color="primary" size="small"
                      disabled={isCreating}
                      onClick={handleCreate}
                      startIcon={isCreating ? <Loader size={14} strokeWidth={1.5} /> : undefined}
                    >
                      {isCreating ? 'Creating...' : 'Create'}
                    </Button>
                  </Box>
                </>
              )}
            </>
          )}
        </Box>
      </Content>
    </Page>
  );
};
