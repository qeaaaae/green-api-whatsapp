import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { persistStorage } from '../lib/storage';

export type Theme = 'light' | 'dark';
export type UiScale = 'small' | 'medium' | 'large';

interface UiState {
  theme: Theme;
  toggleTheme: () => void;
  scale: UiScale;
  setScale: (scale: UiScale) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'light',
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
      scale: 'medium',
      setScale: (scale) => set({ scale }),
    }),
    {
      name: 'green-api-ui',
      storage: createJSONStorage(() => persistStorage),
    },
  ),
);
