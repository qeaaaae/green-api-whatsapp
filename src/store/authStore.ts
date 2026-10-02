import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { persistStorage } from '../lib/storage';
import type { Credentials } from '../types';

interface AuthState {
  credentials: Credentials | null;
  /** Ошибка связи с инстансом - показывается баннером, не персистится */
  connectionError: string | null;
  login: (credentials: Credentials) => void;
  logout: () => void;
  setConnectionError: (error: string | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      credentials: null,
      connectionError: null,
      login: (credentials) => set({ credentials, connectionError: null }),
      logout: () => set({ credentials: null, connectionError: null }),
      setConnectionError: (connectionError) => set({ connectionError }),
    }),
    {
      name: 'green-api-auth',
      storage: createJSONStorage(() => persistStorage),
      partialize: (s) => ({ credentials: s.credentials }),
    },
  ),
);
