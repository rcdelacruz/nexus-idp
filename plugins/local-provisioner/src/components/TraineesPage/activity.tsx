import { createContext, useCallback, useContext, useRef } from 'react';
import type { TraineeListRow } from '../../api/types';
import { ActivityEntry, ActivityQueue, ActivityTarget, entryKey } from './activityQueue';

/** What the cells of the list need from the page: the GitHub answers so far, and a way to say "this row is on screen". */
export interface ActivityApi {
  queue: ActivityQueue | null;
  /** Changes whenever an answer arrives, so a cell that reads the queue draws again. */
  version: number;
  /** A row appeared on screen: its GitHub data is asked for first. Returns what to call when it leaves the screen. */
  register(target: ActivityTarget): () => void;
}

export const ActivityContext = createContext<ActivityApi>({ queue: null, version: 0, register: () => () => {} });

export function useEntry(row: TraineeListRow): ActivityEntry | undefined {
  const { queue } = useContext(ActivityContext);
  return queue?.get(row.key, row.repoUrl);
}

/**
 * The rows on screen are the rows the table has rendered (only its current page), so their cells say so. Rows that appear in the same
 * moment are asked for in one go, in front of everything else; a row that leaves the screen is no longer a "visible" row (Refresh
 * reads only those).
 */
export function useVisibleRows(queue: ActivityQueue | null) {
  const visible = useRef(new Map<string, ActivityTarget>());
  const fresh = useRef(new Map<string, ActivityTarget>());
  const scheduled = useRef(false);

  const flush = useCallback(() => {
    scheduled.current = false;
    if (!queue || fresh.current.size === 0) return;
    const targets = [...fresh.current.values()];
    fresh.current.clear();
    queue.enqueue(targets, { front: true });
  }, [queue]);

  const register = useCallback(
    (target: ActivityTarget) => {
      const id = entryKey(target.key, target.repoUrl);
      visible.current.set(id, target);
      fresh.current.set(id, target);
      if (!scheduled.current) {
        scheduled.current = true;
        void Promise.resolve().then(flush);
      }
      return () => {
        visible.current.delete(id);
      };
    },
    [flush],
  );

  const visibleTargets = useCallback(() => [...visible.current.values()], []);
  return { register, visibleTargets };
}
