import React, { useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { UserEntity } from '@backstage/catalog-model';
import { TextField } from '@material-ui/core';
import { Autocomplete } from '@material-ui/lab';

export interface CatalogUser {
  entityRef: string;
  displayName: string;
  email: string;
}

interface UserPickerFieldProps {
  value: CatalogUser | null;
  onChange: (user: CatalogUser | null) => void;
  label?: string;
  size?: 'small' | 'medium';
}

export const UserPickerField = ({ value, onChange, label = 'User', size = 'medium' }: UserPickerFieldProps) => {
  const catalogApi = useApi(catalogApiRef);
  const [users, setUsers] = useState<CatalogUser[]>([]);

  useEffect(() => {
    catalogApi
      .getEntities({ filter: { kind: 'User' } })
      .then(({ items }) =>
        items.map((e): CatalogUser => {
          const user = e as UserEntity;
          return {
            entityRef: `user:${user.metadata.namespace ?? 'default'}/${user.metadata.name}`,
            displayName: user.spec.profile?.displayName ?? user.metadata.name,
            email: user.spec.profile?.email ?? '',
          };
        }).sort((a, b) => a.displayName.localeCompare(b.displayName)),
      )
      .then(setUsers)
      .catch(() => {});
  }, [catalogApi]);

  return (
    <Autocomplete
      options={users}
      value={value}
      onChange={(_e, selected) => onChange(selected)}
      getOptionLabel={u => u ? `${u.displayName}${u.email ? ` (${u.email})` : ''}` : ''}
      getOptionSelected={(option, val) => option.entityRef === val.entityRef}
      renderInput={params => (
        <TextField {...params} label={label} size={size} fullWidth />
      )}
    />
  );
};
