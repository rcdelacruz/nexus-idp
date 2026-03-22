import '@backstage/cli/asset-types';
import '@backstage/ui/css/styles.css';
import React from 'react';
import './components/Root/overrides.css';
import './catalog-graph-overrides.css';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />,
);
