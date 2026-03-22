import React, { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { TechDocsReaderPage } from '@backstage/plugin-techdocs';
import { TechDocsAddons } from '@backstage/plugin-techdocs-react';
import { ReportIssue } from '@backstage/plugin-techdocs-module-addons-contrib';
import { Mermaid } from 'backstage-plugin-techdocs-addon-mermaid';
import elkLayouts from '@mermaid-js/layout-elk';

export const TechDocsRedirect = () => {
  const { namespace = 'default', kind = 'component', name = '' } = useParams();
  const catalogApi = useApi(catalogApiRef);
  const [redirect, setRedirect] = useState<string | null>(null);

  useEffect(() => {
    catalogApi
      .getEntityByRef(`${kind}:${namespace}/${name}`)
      .then(entity => {
        const sourceId = entity?.metadata?.annotations?.['engineering-docs/source-id'];
        if (sourceId) setRedirect(`/engineering-docs?source=${sourceId}`);
      })
      .catch(() => {});
  }, [catalogApi, namespace, kind, name]);

  // Always render TechDocsReaderPage so the route ref stays registered
  // (required for the "View TechDocs" button in EntityAboutCard to be enabled).
  // When an Engineering Hub source is detected, Navigate redirects before TechDocs loads.
  return (
    <>
      {redirect && <Navigate to={redirect} replace />}
      <TechDocsReaderPage>
        <TechDocsAddons>
          <ReportIssue />
          <Mermaid
            layoutLoaders={elkLayouts}
            config={{ layout: 'elk', theme: 'neutral', look: 'handDrawn', themeVariables: { primaryColor: '#ffffff', mainBkg: '#ffffff' } }}
          />
        </TechDocsAddons>
      </TechDocsReaderPage>
    </>
  );
};
