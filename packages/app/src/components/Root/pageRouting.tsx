import React, { PropsWithChildren, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LOCAL_PROVISIONER_PATH, parseLabTaskPath } from '@internal/plugin-local-provisioner';

/** Fades a page in when it mounts. */
export const PageTransition = ({ children }: PropsWithChildren<{}>) => {
  const [opacity, setOpacity] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpacity(1));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', opacity, transition: 'opacity 0.2s ease' }}>
      {children}
    </div>
  );
};

/**
 * What identifies "the same page" for the fade-in: a new key remounts the page. A lab opened by its
 * URL (/local-provisioner/tasks/<id>) is the Local Provisioner page with a drawer open, so it shares
 * that page's key: opening and closing the drawer must not rebuild the page (its task list, agent
 * filter and selection), only moving to another page does.
 */
export function pageTransitionKey(pathname: string): string {
  return parseLabTaskPath(pathname) ? LOCAL_PROVISIONER_PATH : pathname;
}

/** The routed page with its fade-in, remounted when the page (see pageTransitionKey) changes. */
export const RoutedPage = ({ children }: PropsWithChildren<{}>) => {
  const { pathname } = useLocation();
  return <PageTransition key={pageTransitionKey(pathname)}>{children}</PageTransition>;
};

/**
 * Whether a sidebar item is highlighted. `exact` items match their own path only; a lab opened by
 * its URL counts as the Local Provisioner page, so that item stays lit while a lab's drawer is open
 * (the Trainees item, a separate page under the same prefix, does not).
 */
export function isNavItemActive(pathname: string, to: string | undefined, exact: boolean): boolean {
  if (!to) return false;
  if (exact) {
    return pathname === to || (to === LOCAL_PROVISIONER_PATH && parseLabTaskPath(pathname) !== undefined);
  }
  return to !== '/' && pathname.startsWith(to);
}
