import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// Тема и масштаб выставляются до первой отрисовки - иначе на тёмной теме
// после F5 видна вспышка светлой, пока App не смонтируется
try {
  const persisted = JSON.parse(
    localStorage.getItem('green-api-ui') ?? '{}',
  ) as { state?: { theme?: string; scale?: string } };
  if (persisted.state?.theme) {
    document.documentElement.dataset.theme = persisted.state.theme;
  }
  if (persisted.state?.scale) {
    document.documentElement.dataset.scale = persisted.state.scale;
  }
} catch {
  // localStorage недоступен (приватный режим) - применятся дефолты App
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
