import type { StateStorage } from 'zustand/middleware';

const memoryStore = new Map<string, string>();

const memoryStorage: StateStorage = {
  getItem: (k) => memoryStore.get(k) ?? null,
  setItem: (k, v) => {
    memoryStore.set(k, String(v));
  },
  removeItem: (k) => {
    memoryStore.delete(k);
  },
};

function isLocalStorageUsable(): boolean {
  try {
    const probe = '__storage_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

// В тестах и приватном режиме localStorage может бросать - храним стейт в памяти
export const persistStorage: StateStorage = isLocalStorageUsable()
  ? localStorage
  : memoryStorage;
