import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.tsx';
import './i18n/index.ts';
import './styles/globals.css';
import { applyTheme, useUi } from './lib/ui-store.ts';

// Temani birinchi renderdan OLDIN qo'llaymiz - chaqnash bo'lmasin.
applyTheme(useUi.getState().theme);

const root = document.getElementById('root');
if (!root) throw new Error('#root elementi topilmadi');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
