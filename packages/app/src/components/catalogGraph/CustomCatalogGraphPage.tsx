import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import qs from 'qs';
import { parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import {
  Page,
  Header,
  Content,
  ContentHeader,
  SupportButton,
  Select,
} from '@backstage/core-components';
import { useApi, alertApiRef, createRoutableExtension } from '@backstage/core-plugin-api';
import { CatalogFilterLayout } from '@backstage/plugin-catalog-react';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { Grid, Box, Typography, FormControlLabel, Switch, Checkbox, TextField, FormControl, OutlinedInput, InputAdornment, IconButton, Paper } from '@material-ui/core';
import Autocomplete from '@material-ui/lab/Autocomplete';
import { CheckSquare, Square, ChevronDown, X, Maximize2 } from 'lucide-react';
import useAsync from 'react-use/esm/useAsync';
import {
  EntityRelationsGraph,
  catalogGraphApiRef,
  catalogGraphPlugin,
  Direction,
} from '@backstage/plugin-catalog-graph';

// ─── State management (mirrors useCatalogGraphPage) ──────────────────────────

function parseMaxDepth(value: string) {
  return value === '∞' ? Number.POSITIVE_INFINITY : Number(value);
}

function useCatalogGraphState(initialState: {
  selectedRelations?: string[];
  selectedKinds?: string[];
  rootEntityRefs?: string[];
  maxDepth?: number;
  unidirectional?: boolean;
  mergeRelations?: boolean;
  direction?: Direction;
  curve?: 'curveStepBefore' | 'curveMonotoneX';
} = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const query = useMemo(
    () => qs.parse(location.search, { arrayLimit: 10000, ignoreQueryPrefix: true }) || {},
    [location.search],
  );

  const rootEntityNames = useMemo(
    () =>
      (Array.isArray(query.rootEntityRefs)
        ? query.rootEntityRefs
        : initialState.rootEntityRefs ?? []
      ).map((r: any) => parseEntityRef(r as string)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialState.rootEntityRefs, query.rootEntityRefs],
  );

  const setRootEntityNames = useCallback(
    (value: ReturnType<typeof parseEntityRef>[]) => {
      const areSame =
        rootEntityNames.length === value.length &&
        rootEntityNames.every((r, i) => stringifyEntityRef(r) === stringifyEntityRef(value[i]));
      if (areSame) return;
      const newSearch = qs.stringify(
        { ...query, rootEntityRefs: value.map(r => stringifyEntityRef(r)) },
        { arrayFormat: 'brackets', addQueryPrefix: true },
      );
      navigate(newSearch);
    },
    [rootEntityNames, navigate, query],
  );

  const [maxDepth, setMaxDepth] = useState(() =>
    typeof query.maxDepth === 'string'
      ? parseMaxDepth(query.maxDepth)
      : initialState.maxDepth ?? Number.POSITIVE_INFINITY,
  );
  const [selectedRelations, setSelectedRelations] = useState<string[] | undefined>(() =>
    Array.isArray(query.selectedRelations) ? (query.selectedRelations as string[]) : initialState.selectedRelations,
  );
  const [selectedKinds, setSelectedKinds] = useState<string[] | undefined>(() =>
    (Array.isArray(query.selectedKinds) ? (query.selectedKinds as string[]) : initialState.selectedKinds)?.map(k =>
      k.toLocaleLowerCase('en-US'),
    ),
  );
  const [unidirectional, setUnidirectional] = useState(() =>
    typeof query.unidirectional === 'string'
      ? query.unidirectional === 'true'
      : initialState.unidirectional ?? true,
  );
  const [mergeRelations, setMergeRelations] = useState(() =>
    typeof query.mergeRelations === 'string'
      ? query.mergeRelations === 'true'
      : initialState.mergeRelations ?? true,
  );
  const [direction, setDirection] = useState<Direction>(() =>
    typeof query.direction === 'string' ? (query.direction as Direction) : initialState.direction ?? Direction.LEFT_RIGHT,
  );
  const [curve, setCurve] = useState<'curveStepBefore' | 'curveMonotoneX'>(() =>
    typeof query.curve === 'string'
      ? (query.curve as 'curveStepBefore' | 'curveMonotoneX')
      : initialState.curve ?? 'curveMonotoneX',
  );

  useEffect(() => {
    const newParams = qs.stringify(
      {
        rootEntityRefs: rootEntityNames.map(stringifyEntityRef),
        maxDepth: isFinite(maxDepth) ? maxDepth : '∞',
        selectedKinds,
        selectedRelations,
        unidirectional,
        mergeRelations,
        direction,
        curve,
      },
      { arrayFormat: 'brackets', addQueryPrefix: true },
    );
    navigate(newParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxDepth, curve, selectedKinds, selectedRelations, unidirectional, mergeRelations, direction, rootEntityNames]);

  return {
    rootEntityNames,
    setRootEntityNames,
    maxDepth,
    setMaxDepth,
    selectedRelations,
    setSelectedRelations,
    selectedKinds,
    setSelectedKinds,
    unidirectional,
    setUnidirectional,
    mergeRelations,
    setMergeRelations,
    direction,
    setDirection,
    curve,
    setCurve,
  };
}

// ─── Filter components ────────────────────────────────────────────────────────

function KindsFilter({ value, onChange }: { value?: string[]; onChange: (v?: string[]) => void }) {
  const alertApi = useApi(alertApiRef);
  const catalogApi = useApi(catalogApiRef);
  const { error, value: kinds } = useAsync(async () =>
    catalogApi
      .getEntityFacets({ facets: ['kind'] })
      .then(r => r.facets.kind?.map(f => f.value).sort() ?? []),
  );
  useEffect(() => {
    if (error) alertApi.post({ message: 'Failed to load entity kinds', severity: 'error' });
  }, [error, alertApi]);
  const normalized = useMemo(() => kinds?.map(k => k.toLocaleLowerCase('en-US')), [kinds]);
  const handleChange = useCallback(
    (_: any, v: string[]) => {
      onChange(normalized && normalized.every(r => v.includes(r)) ? undefined : v);
    },
    [normalized, onChange],
  );
  if (!kinds?.length || !normalized?.length || error) return null;
  return (
    <Box pb={1} pt={1}>
      <Typography variant="button">Kinds</Typography>
      <Autocomplete
        multiple
        limitTags={4}
        disableCloseOnSelect
        options={normalized}
        value={value ?? normalized}
        getOptionLabel={k => kinds[normalized.indexOf(k)] ?? k}
        onChange={handleChange}
        onBlur={() => onChange(value?.length ? value : undefined)}
        renderOption={(option, { selected }) => (
          <FormControlLabel
            control={
              <Checkbox
                icon={<Square size={16} strokeWidth={1.5} />}
                checkedIcon={<CheckSquare size={16} strokeWidth={1.5} />}
                checked={selected}
              />
            }
            label={kinds[normalized.indexOf(option)] ?? option}
          />
        )}
        size="small"
        popupIcon={<ChevronDown size={16} strokeWidth={1.5} />}
        renderInput={params => <TextField {...params} variant="outlined" />}
      />
    </Box>
  );
}

function RelationsFilter({
  value,
  onChange,
}: {
  value?: string[];
  onChange: (v?: string[]) => void;
}) {
  const { knownRelations, defaultRelations } = useApi(catalogGraphApiRef);
  const defaultValue = useMemo(
    () => knownRelations.filter(r => defaultRelations.includes(r)),
    [knownRelations, defaultRelations],
  );
  return (
    <Box pb={1} pt={1}>
      <Typography variant="button">Relations</Typography>
      <Autocomplete<string, true, undefined, undefined>
        multiple
        limitTags={4}
        disableCloseOnSelect
        options={knownRelations as string[]}
        value={(value ?? defaultValue) as string[]}
        onChange={(_: any, v: string[]) => onChange(v)}
        onBlur={() => onChange(value?.length ? value : undefined)}
        renderOption={(option, { selected }) => (
          <FormControlLabel
            control={
              <Checkbox
                icon={<Square size={16} strokeWidth={1.5} />}
                checkedIcon={<CheckSquare size={16} strokeWidth={1.5} />}
                checked={selected}
              />
            }
            label={option}
          />
        )}
        size="small"
        popupIcon={<ChevronDown size={16} strokeWidth={1.5} />}
        renderInput={params => <TextField {...params} variant="outlined" />}
      />
    </Box>
  );
}

function MaxDepthFilterWidget({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const onChangeRef = useRef(onChange);
  const [current, setCurrent] = useState(value);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { setCurrent(value); }, [value]);
  const handle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    const v = Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
    setCurrent(v);
    onChangeRef.current(v);
  }, []);
  return (
    <Box pb={1} pt={1}>
      <FormControl variant="outlined" style={{ width: '100%' }}>
        <Typography variant="button">Max Depth</Typography>
        <OutlinedInput
          type="number"
          placeholder="∞"
          value={Number.isFinite(current) ? String(current) : ''}
          onChange={handle}
          endAdornment={
            <InputAdornment position="end">
              <IconButton
                onClick={() => { setCurrent(Number.POSITIVE_INFINITY); onChangeRef.current(Number.POSITIVE_INFINITY); }}
                edge="end"
              >
                <X size={16} strokeWidth={1.5} />
              </IconButton>
            </InputAdornment>
          }
          labelWidth={0}
        />
      </FormControl>
    </Box>
  );
}

function SwitchFilterWidget({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Box pb={1} pt={1}>
      <FormControlLabel
        control={<Switch checked={value} onChange={e => onChange(e.target.checked)} color="primary" />}
        label={label}
      />
    </Box>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const CustomCatalogGraphPageInner = () => {
  const {
    rootEntityNames,
    setRootEntityNames,
    maxDepth,
    setMaxDepth,
    selectedRelations,
    setSelectedRelations,
    selectedKinds,
    setSelectedKinds,
    unidirectional,
    setUnidirectional,
    mergeRelations,
    setMergeRelations,
    direction,
    setDirection,
    curve,
    setCurve,
  } = useCatalogGraphState();

  const navigate = useNavigate();

  const onNodeClick = useCallback(
    (node: any, event: React.MouseEvent<unknown>) => {
      const nodeEntityName = parseEntityRef(node.id);
      if (event.shiftKey) {
        navigate(
          `/catalog/${nodeEntityName.namespace.toLocaleLowerCase('en-US')}/${nodeEntityName.kind.toLocaleLowerCase('en-US')}/${nodeEntityName.name}`,
        );
      } else {
        setRootEntityNames([nodeEntityName]);
      }
    },
    [navigate, setRootEntityNames],
  );

  return (
    <Page themeId="home">
      <Header
        title="Catalog Graph"
        subtitle={rootEntityNames.map(e => `${e.kind}:${e.namespace}/${e.name}`).join(', ')}
      />
      <Content stretch>
        <ContentHeader title="">
          <SupportButton>Explore entity relationships in the catalog.</SupportButton>
        </ContentHeader>
        <CatalogFilterLayout>
          <CatalogFilterLayout.Filters options={{ drawerBreakpoint: 'xl' }}>
            <KindsFilter value={selectedKinds} onChange={setSelectedKinds} />
            <RelationsFilter value={selectedRelations} onChange={setSelectedRelations} />
            <MaxDepthFilterWidget value={maxDepth} onChange={setMaxDepth} />
            <Select
              label="Direction"
              selected={direction}
              items={[
                { label: 'Left to right', value: Direction.LEFT_RIGHT },
                { label: 'Right to left', value: Direction.RIGHT_LEFT },
                { label: 'Top to bottom', value: Direction.TOP_BOTTOM },
                { label: 'Bottom to top', value: Direction.BOTTOM_TOP },
              ]}
              onChange={v => setDirection(v as Direction)}
            />
            <Box pt={1}>
              <Select
                label="Curve"
                selected={curve}
                items={[
                  { label: 'Smooth', value: 'curveMonotoneX' },
                  { label: 'Stepped', value: 'curveStepBefore' },
                ]}
                onChange={v => setCurve(v as 'curveMonotoneX' | 'curveStepBefore')}
              />
            </Box>
            <SwitchFilterWidget label="Simplified" value={unidirectional} onChange={setUnidirectional} />
            <SwitchFilterWidget label="Merge relations" value={mergeRelations} onChange={setMergeRelations} />
          </CatalogFilterLayout.Filters>
          <Grid item xs={12} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Paper style={{ flex: 1, minHeight: 600, position: 'relative', display: 'flex' }}>
              <Typography
                variant="caption"
                color="textSecondary"
                display="block"
                style={{ position: 'absolute', bottom: 0, right: 0, padding: 8 }}
              >
                <Maximize2 size={16} strokeWidth={1.5} style={{ verticalAlign: 'bottom' }} /> Scroll to zoom
              </Typography>
              <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                <EntityRelationsGraph
                  rootEntityNames={rootEntityNames.length > 0 ? rootEntityNames : [{ kind: 'Component', namespace: 'default', name: 'unknown' }]}
                  maxDepth={maxDepth}
                  kinds={selectedKinds && selectedKinds.length > 0 ? selectedKinds : undefined}
                  relations={selectedRelations && selectedRelations.length > 0 ? selectedRelations : undefined}
                  mergeRelations={mergeRelations}
                  unidirectional={unidirectional}
                  onNodeClick={onNodeClick}
                  direction={direction}
                  curve={curve}
                  zoom="enabled"
                />
              </div>
            </Paper>
          </Grid>
        </CatalogFilterLayout>
      </Content>
    </Page>
  );
};

export const CustomCatalogGraphPage = catalogGraphPlugin.provide(
  createRoutableExtension({
    name: 'CatalogGraphPage',
    component: () => Promise.resolve(CustomCatalogGraphPageInner),
    mountPoint: catalogGraphPlugin.routes.catalogGraph,
  }),
);
