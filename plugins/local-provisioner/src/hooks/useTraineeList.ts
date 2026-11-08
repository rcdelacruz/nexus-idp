import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../api/LocalProvisionerClient';
import type { TraineeListRow } from '../api/types';

export interface TraineeListError {
  message: string;
  status?: number;
}

/**
 * The Trainees list (database only, small rows). Reloading keeps the rows already on screen until the new ones arrive, so the page
 * never goes blank; a failed reload keeps them too and reports the error next to them.
 */
export function useTraineeList() {
  const api = useApi(localProvisionerApiRef);
  const [rows, setRows] = useState<TraineeListRow[] | null>(null);
  const [error, setError] = useState<TraineeListError | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.getTraineeList());
      setError(null);
    } catch (e: any) {
      setError({ message: e.message, status: e.status });
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rows, error, loading, reload };
}
