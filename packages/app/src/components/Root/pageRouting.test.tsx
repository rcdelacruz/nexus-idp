import React, { useEffect } from 'react';
// The wiring check at the end reads Root.tsx itself (the Root component needs the whole app to render).
// eslint-disable-next-line no-restricted-imports
import fs from 'fs';
// eslint-disable-next-line no-restricted-imports
import path from 'path';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { isNavItemActive, pageTransitionKey, RoutedPage } from './pageRouting';

const LAB = '/local-provisioner/tasks/3f2b8c1e-5a7d-4e90-9b1c-0d4e6f8a1b2c';

describe('pageTransitionKey', () => {
  it('gives a lab opened by its URL the key of the Local Provisioner page', () => {
    expect(pageTransitionKey(LAB)).toBe('/local-provisioner');
    expect(pageTransitionKey(`${LAB}/`)).toBe('/local-provisioner');
    expect(pageTransitionKey('/local-provisioner')).toBe('/local-provisioner');
  });

  it('keeps every other page on its own path', () => {
    expect(pageTransitionKey('/local-provisioner/trainees')).toBe('/local-provisioner/trainees');
    expect(pageTransitionKey('/local-provisioner/tasks/not-a-task')).toBe('/local-provisioner/tasks/not-a-task');
    expect(pageTransitionKey('/catalog')).toBe('/catalog');
    expect(pageTransitionKey('/create/tasks/abc')).toBe('/create/tasks/abc');
  });
});

describe('RoutedPage', () => {
  // A page that counts how many times it has been built, inside the real RoutedPage.
  let mounts = 0;
  const Page = () => {
    useEffect(() => {
      mounts += 1;
    }, []);
    return <div>page</div>;
  };
  let go: (to: string, replace?: boolean) => void;
  const Nav = () => {
    const navigate = useNavigate();
    go = (to, replace) => navigate(to, { replace });
    return null;
  };
  const mount = (start: string) => {
    mounts = 0;
    render(
      <MemoryRouter initialEntries={[start]}>
        <Nav />
        <RoutedPage>
          <Page />
        </RoutedPage>
      </MemoryRouter>,
    );
  };
  const navigateTo = (to: string, replace = false) =>
    act(async () => {
      go(to, replace);
    });

  it('does not rebuild the page when a lab drawer opens and closes', async () => {
    mount('/local-provisioner');
    expect(mounts).toBe(1);
    await navigateTo(LAB);
    expect(screen.getByText('page')).toBeInTheDocument();
    await navigateTo('/local-provisioner', true);
    expect(mounts).toBe(1);
  });

  it('does rebuild the page when you arrive from another page, and when you leave', async () => {
    mount('/create/tasks/run-1');
    expect(mounts).toBe(1);
    await navigateTo(LAB, true); // the redirect from the run page
    expect(mounts).toBe(2);
    await navigateTo('/local-provisioner/trainees');
    expect(mounts).toBe(3);
    await navigateTo('/catalog');
    expect(mounts).toBe(4);
  });
});

describe('isNavItemActive', () => {
  it('lights the Local Provisioner item on its page and on a lab opened by its URL', () => {
    expect(isNavItemActive('/local-provisioner', '/local-provisioner', true)).toBe(true);
    expect(isNavItemActive(LAB, '/local-provisioner', true)).toBe(true);
  });

  it('does not light it on the Trainees page, or on a path that only looks like a lab', () => {
    expect(isNavItemActive('/local-provisioner/trainees', '/local-provisioner', true)).toBe(false);
    expect(isNavItemActive('/local-provisioner/tasks/not-a-task', '/local-provisioner', true)).toBe(false);
  });

  it('lights Trainees on its own page and not on a lab', () => {
    expect(isNavItemActive('/local-provisioner/trainees', '/local-provisioner/trainees', false)).toBe(true);
    expect(isNavItemActive(LAB, '/local-provisioner/trainees', false)).toBe(false);
  });

  it('keeps the other items as they were: prefix match, except the home item and items with no target', () => {
    expect(isNavItemActive('/catalog/default/component/x', '/catalog', false)).toBe(true);
    expect(isNavItemActive('/catalog', '/', false)).toBe(false);
    expect(isNavItemActive('/anything', undefined, false)).toBe(false);
    expect(isNavItemActive(LAB, '/catalog', true)).toBe(false);
  });
});

describe('Root.tsx uses them', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'Root.tsx'), 'utf8');

  it('wraps the routed page in RoutedPage and no longer keys the fade-in on the raw path', () => {
    expect(source).toContain('<RoutedPage>');
    expect(source).not.toMatch(/<PageTransition[^>]*key=\{location\.pathname\}/);
  });

  it('decides which sidebar item is lit with isNavItemActive', () => {
    expect(source).toContain('isNavItemActive(location.pathname, to, exact)');
  });
});
