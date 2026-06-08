import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyResolvedTheme, loadTheme, resolveTheme } from './lib/theme.ts';
import './index.css';

// Apply the stored theme before first paint to avoid a flash of the wrong theme.
applyResolvedTheme(
  document.documentElement,
  resolveTheme(loadTheme(localStorage), window.matchMedia('(prefers-color-scheme: dark)').matches),
);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
