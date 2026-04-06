# Nexus IDP Design System

This document defines the visual language for Nexus IDP. Every frontend page, plugin, and component must follow these guidelines. The design system is based on **Vercel's Geist** — adapted for our Backstage portal.

## Principles

1. **Consistency** — every page must feel like the same product. When a pattern changes on one page, it changes on all pages.
2. **Simplicity** — clean surfaces, minimal borders, no shadows, no gradients.
3. **Legibility** — tight but readable typography with clear visual hierarchy.
4. **Adaptive** — supports dark and light mode via CSS variables and `useColors()`.

---

## Fonts

| Usage | Font Stack |
|-------|-----------|
| UI / Body | `"Geist", "Helvetica Neue", Arial, sans-serif` |
| Code / Mono | `"Geist Mono", "Fira Code", "Courier New", monospace` |

Loaded from Google Fonts in `packages/app/public/index.html`.

---

## Color Tokens

All colors come from `@stratpoint/theme-utils` via the `useColors()` hook. Never hardcode hex values in component files.

### Dark Mode

| Token | Hex | Usage |
|-------|-----|-------|
| `c.bg` | `#000000` | Page background |
| `c.surfaceSubtle` | `#050505` | Subtle elevation |
| `c.surface` | `#0a0a0a` | Card/panel background |
| `c.avatarBg` / `c.inputBg` | `#1a1a1a` | Input backgrounds, avatars |
| `c.hoverBg` | `#1f1f1f` | Hover states |
| `c.border` | `#2e2e2e` | All borders |
| `c.borderHover` | `#454545` | Border on hover |
| `c.text` | `#ededed` | Primary text |
| `c.textSecondary` | `#a1a1a1` | Secondary text |
| `c.textMuted` | `#878787` | Tertiary/muted text |
| `c.textDisabled` | `#454545` | Disabled text |
| `c.blue` | `#3291ff` | Accent / active state |

### Light Mode

| Token | Hex | Usage |
|-------|-----|-------|
| `c.bg` | `#fafafa` | Page background |
| `c.surface` | `#ffffff` | Card/panel background |
| `c.border` | `#ebebeb` | All borders |
| `c.borderHover` | `#c9c9c9` | Border on hover |
| `c.text` | `#171717` | Primary text |
| `c.textSecondary` | `#4d4d4d` | Secondary text |
| `c.textMuted` | `#8f8f8f` | Tertiary/muted text |
| `c.blue` | `#0070f3` | Accent / active state |

### Semantic Colors (same in both modes)

| Token | Hex | Usage |
|-------|-----|-------|
| `semantic.success` | `#22c55e` | Success states |
| `semantic.successBg` | `#14532d` | Success background |
| `semantic.error` | `#e53935` | Error states |
| `semantic.errorBg` | `#3b0e0e` | Error background |
| `semantic.warning` | `#fb8c00` | Warning states |
| `semantic.warningBg` | `#1a0f00` | Warning background |
| `semantic.info` | `#38bdf8` | Info states |
| `semantic.purple` | `#a855f7` | Purple accent (admin badges, etc.) |

---

## Typography Scale

| Element | Size | Weight | Letter-Spacing | Line-Height |
|---------|------|--------|---------------|-------------|
| Hero heading | `3.5rem` | 600 | `-0.06em` | 1.02 |
| Page title | `1.25rem` | 600 | `-0.03em` | 1.3 |
| Section heading | `1.125rem` | 600 | `-0.025em` | — |
| Body | `0.875rem` | 400 | `-0.006em` | 1.5 |
| Small / Label | `0.8125rem` | 500 | `-0.006em` | — |
| Caption | `0.75rem` | 400 | — | — |
| Section label (overline) | `0.6875rem` | 600 | `0.06em` | — |
| Badge | `0.6875rem` | 600 | `0.06em` | — |

### Section Labels

Used above form sections, table headers, and content groups:

```tsx
<Typography style={{
  fontSize: '0.6875rem',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: c.textMuted,
  marginBottom: 12,
}}>
  Section Title
</Typography>
```

---

## Spacing

Based on a 4px grid:

| Scale | Value |
|-------|-------|
| 1 | `4px` |
| 2 | `8px` |
| 3 | `12px` |
| 4 | `16px` |
| 5 | `20px` |
| 6 | `24px` |
| 8 | `32px` |
| 10 | `40px` |
| 12 | `48px` |

| Context | Value |
|---------|-------|
| Page content padding | `24px` (set by BackstageContent override) |
| Card padding | `20px 24px` |
| Grid gaps | `10–12px` |
| Section gap | `48px` |

---

## Border Radius

| Element | Radius |
|---------|--------|
| Buttons, inputs | `6px` |
| Cards, containers, member rows | `8px` |
| Dialogs | `12px` |
| Badges, pills | `9999px` (full) |

---

## Icons

**Use `lucide-react` exclusively.** Never use `@material-ui/icons`.

```tsx
import { Pencil, Trash2, CheckCircle } from 'lucide-react';

// In cards and tables
<Pencil size={16} strokeWidth={1.5} />

// In small contexts (badges, inline)
<CheckCircle size={14} strokeWidth={1.5} />

// Large decorative (success states)
<CheckCircle size={40} strokeWidth={1.5} color={semantic.success} />
```

| Context | Size | strokeWidth |
|---------|------|------------|
| Table actions, buttons | `16` | `1.5` |
| Card icons, inline | `14` | `1.5` |
| Step indicators | `14–16` | `1.5–2` |
| Decorative (success/error states) | `28–48` | `1.5` |

---

## Components

### Cards

```tsx
const card = {
  background: c.surface,
  border: `1px solid ${c.border}`,
  borderRadius: 8,
  padding: '20px 24px',
};
```

Hover: border changes to `c.borderHover` — no shadow, no scale.

### Buttons

All buttons use MUI `Button` styled by `theme.ts`:

| Variant | Usage |
|---------|-------|
| `variant="contained" color="primary"` | Primary action (Next, Create, Save) |
| `variant="outlined"` | Secondary action (Back, Cancel) |
| `size="small"` | Form footers (height 32px) |
| Default size | Standalone buttons (height 40px) |

For destructive actions, use inline red:

```tsx
<Button
  variant="contained"
  style={{ backgroundColor: '#e5484d', color: '#ffffff' }}
>
  Delete
</Button>
```

Never use `color="secondary"` for destructive actions (it's purple).

### Native Buttons (Geist style)

Used for Add/Remove member, action links:

```tsx
<button
  type="button"
  onClick={handleClick}
  style={{
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
    background: 'transparent', border: `1px solid ${c.border}`,
    color: c.textSecondary, fontSize: '0.8125rem', fontWeight: 500,
  }}
>
  <UserPlus size={14} strokeWidth={1.5} aria-hidden="true" />
  Add Team Member
</button>
```

### Form Inputs

All `TextField` components must have:

```tsx
<TextField
  fullWidth
  variant="outlined"
  size="small"
  label="Field Name"
  value={value}
  onChange={handler}
/>
```

For multiline, override the fixed height:

```tsx
<TextField
  fullWidth multiline minRows={3}
  variant="outlined" size="small"
  InputProps={{ style: { height: 'auto' } }}
/>
```

### Step Indicators

Circle on top, label below, connector line between. Used in Project Registration and Scaffolder wizard:

```tsx
<Box display="flex" alignItems="flex-start" style={{ marginBottom: 24 }}>
  {steps.map((step, idx) => {
    const isDone = idx < activeStep;
    const isActive = idx === activeStep;
    return (
      <React.Fragment key={step.label}>
        <Box display="flex" flexDirection="column" alignItems="center" style={{ flex: 0, minWidth: 60 }}>
          <Box
            display="flex" alignItems="center" justifyContent="center"
            style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: isDone ? semantic.successBg : isActive ? c.surface : 'transparent',
              border: `2px solid ${isDone ? semantic.success : isActive ? c.blue : c.border}`,
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
            color: isDone ? c.textSecondary : isActive ? c.text : c.textMuted,
            marginTop: 6, textAlign: 'center', lineHeight: 1.3, maxWidth: 100,
          }}>
            {step.label}
          </Typography>
        </Box>
        {idx < steps.length - 1 && (
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
```

### Review Layout

Used before form submission (Project Registration, Scaffolder):

```tsx
const reviewRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  padding: '10px 0',
  borderBottom: `1px solid ${c.border}`,
};

const reviewLabel: React.CSSProperties = {
  fontSize: '0.8125rem', color: c.textMuted, fontWeight: 500,
  minWidth: 160, flexShrink: 0,
};

const reviewValue: React.CSSProperties = {
  fontSize: '0.875rem', color: c.text, textAlign: 'right',
  wordBreak: 'break-word', maxWidth: 400,
};
```

### Badges

Use the `badge()` function from `@stratpoint/theme-utils`:

```tsx
import { badge } from '@stratpoint/theme-utils';

<span style={badge('green')}>Done</span>
<span style={badge('amber')}>Pending</span>
<span style={badge('purple')}>Admin</span>
<span style={badge('blue-subtle')}>Info</span>
```

### Error Alerts

```tsx
<Box
  role="alert"
  display="flex" alignItems="flex-start"
  style={{
    gap: 10,
    background: semantic.errorBg,
    border: `1px solid ${semantic.error}33`,
    borderRadius: 8,
    padding: '12px 14px',
  }}
>
  <AlertCircle size={16} strokeWidth={1.5} color={semantic.error} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
  <Typography style={{ fontSize: '0.8125rem', color: semantic.error, lineHeight: 1.5 }}>
    {errorMessage}
  </Typography>
</Box>
```

---

## Page Layout

### Standard Form Pages

```tsx
<Page themeId="tool">
  <Header title="Page Title" subtitle="Description" />
  <Content>
    <Box style={{ maxWidth: 960, width: '100%', margin: '0 auto' }}>
      {/* Step indicator */}
      {/* Form card */}
      {/* Footer buttons (outside card) */}
    </Box>
  </Content>
</Page>
```

### Table Pages

```tsx
<Page themeId="tool">
  <Header title="Page Title" subtitle="Description" />
  <Content>
    {/* Section label + toolbar */}
    {/* TableContainer > Table */}
    {/* Dialogs */}
  </Content>
</Page>
```

---

## Sidebar

The sidebar is always dark regardless of theme mode:

- Background: `#000000`
- Border: `1px solid #2e2e2e`
- Nav items: height `36px`, radius `6px`, lucide icons `size={16} strokeWidth={1.5}`
- Active item: background `#1f1f1f`, color `#ededed`

---

## Accessibility

- `aria-label` on all interactive elements (buttons, icon buttons, form fields)
- `aria-hidden="true"` on decorative icons
- `role="alert"` on error/success messages
- Proper color contrast (WCAG AA minimum)

---

## Key Files

| File | Purpose |
|------|---------|
| `packages/app/src/theme.ts` | MUI component overrides — single source of truth for global styling |
| `packages/theme-utils/src/index.ts` | `useColors()`, `semantic`, `badge()`, `spacing`, `borderRadius` |
| `packages/app/src/components/Root/NexusLogo.tsx` | Logo components (NexusLogoFull, NexusLogoHorizontal, NexusLogoMark) |
| `packages/app/public/nexus_favicon.svg` | Adaptive favicon (prefers-color-scheme) |

---

## Rules for Contributors

1. **Never import from `@material-ui/icons`** — use `lucide-react`
2. **Never hardcode hex colors** — use `useColors()` or `semantic` from `@stratpoint/theme-utils`
3. **Never use `makeStyles`** for colors/spacing — use inline styles with `useColors()` tokens
4. **Every form field**: `variant="outlined" size="small"`
5. **Every destructive button**: red `#e5484d`, never purple `color="secondary"`
6. **When changing a pattern on one page, apply the same change to all pages** that use that pattern
