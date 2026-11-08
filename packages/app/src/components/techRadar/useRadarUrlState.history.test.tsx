import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { renderInTestApp } from '@backstage/test-utils';
import { useLocation, useNavigationType } from 'react-router-dom';
import { useRadarUrlState } from './useRadarUrlState';

const Probe = () => {
  const { state, update } = useRadarUrlState();
  const location = useLocation();
  const type = useNavigationType();
  return (
    <div>
      <button onClick={() => update({ blip: 'a' }, { push: true })}>open</button>
      <button onClick={() => update({ blip: 'b' }, { push: !state.blip })}>jump</button>
      <button onClick={() => update({ blip: undefined })}>close</button>
      <output data-testid="at">{`${location.search || '(none)'} via ${type}`}</output>
    </div>
  );
};

const at = () => screen.getByTestId('at').textContent;

describe('radar history', () => {
  it('Close steps back when this page opened the technology, so Back is never a dead step', async () => {
    await renderInTestApp(<Probe />, { routeEntries: ['/tech-radar'] });
    fireEvent.click(screen.getByText('open'));
    expect(at()).toBe('?blip=a via PUSH');
    fireEvent.click(screen.getByText('close'));
    expect(at()).toBe('(none) via POP'); // it went back: no new history entry
  });

  it('jumping between technologies keeps a single step to go back', async () => {
    await renderInTestApp(<Probe />, { routeEntries: ['/tech-radar'] });
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('jump'));
    expect(at()).toBe('?blip=b via REPLACE');
    fireEvent.click(screen.getByText('close'));
    expect(at()).toBe('(none) via POP');
  });

  it('a technology that was open in the shared link is closed in place (Back still leaves the page)', async () => {
    await renderInTestApp(<Probe />, { routeEntries: ['/tech-radar?blip=a'] });
    fireEvent.click(screen.getByText('close'));
    expect(at()).toBe('(none) via REPLACE');
  });
});
