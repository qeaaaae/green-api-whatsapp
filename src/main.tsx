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

// Запрет pinch-зума: iOS с 10 версии игнорирует user-scalable=no,
// поэтому глушим multi-touch и gesture-события руками
document.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
