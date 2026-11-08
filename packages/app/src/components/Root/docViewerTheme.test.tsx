import React from 'react';
import { render, screen } from '@testing-library/react';
import { PALETTES } from '@stratpoint/theme-utils';
// CodeBlock is rendered into its own React roots (no theme provider), so it must be told the theme id.
// It is not part of the plugin's public API, so this test imports it by path.
// eslint-disable-next-line @backstage/no-forbidden-package-imports
import { CodeBlock } from '@internal/plugin-engineering-docs/src/components/EngineeringDocsPage/DocViewer';

const headerOf = (label: string) => {
  const header = screen.getByText(label).parentElement as HTMLElement;
  return header.style.background;
};

describe('docs code blocks follow the chosen theme', () => {
  it.each(['dark', 'dark-midnight', 'dark-warm', 'dark-contrast', 'dark-classic'] as const)('%s', id => {
    const { unmount } = render(<CodeBlock code="echo hi" language="bash" dark themeId={id} title={`t-${id}`} />);
    // jsdom normalises colours to rgb(), so compare through a probe element
    const probe = document.createElement('div');
    probe.style.background = PALETTES[id].surface;
    expect(headerOf(`t-${id}`)).toBe(probe.style.background);
    unmount();
  });

  it('uses the default dark theme when no id is given', () => {
    render(<CodeBlock code="echo hi" language="bash" dark title="plain" />);
    const probe = document.createElement('div');
    probe.style.background = PALETTES.dark.surface;
    expect(headerOf('plain')).toBe(probe.style.background);
  });
});
