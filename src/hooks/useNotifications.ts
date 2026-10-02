import { useEffect } from 'react';
import { deleteNotification, receiveNotification } from '../api/greenApi';
import { pollLoop } from '../lib/poller';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { useUiStore } from '../store/uiStore';

const TAB_LOCK_NAME = 'green-api-notifications';

// Синхронизация сторов между вкладками: persist пишет в localStorage,
// событие storage доезжает только до других вкладок - делаем rehydrate.
export function useTabSync() {
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'green-api-chats') void useChatStore.persist.rehydrate();
      if (event.key === 'green-api-auth') void useAuthStore.persist.rehydrate();
      if (event.key === 'green-api-ui') void useUiStore.persist.rehydrate();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}

export function useNotifications() {
  const credentials = useAuthStore((s) => s.credentials);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (!credentials) return;
    const creds = credentials;
    const controller = new AbortController();
    let stopped = false;

    // sleep, прерываемый abort: таймер + отписка на сигнал.
    // Слушатель обязательно снимаем - иначе каждый sleep оставляет
    // обработчик на общем signal и за сессию копятся тысячи
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          controller.signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });

    const run = () =>
      pollLoop({
        creds,
        isStopped: () => stopped,
        sleep,
        receive: (c) => receiveNotification(c, controller.signal),
        acknowledge: deleteNotification,
        onUnauthorized: logout,
      });

    // Web Locks: поллит только вкладка-лидер, остальные ждут лока.
    // Без navigator.locks (старые браузеры) - поллим напрямую.
    if ('locks' in navigator) {
      navigator.locks
        .request(TAB_LOCK_NAME, { signal: controller.signal }, () => run())
        .catch(() => {});
    } else {
      void run();
    }

    return () => {
      stopped = true;
      controller.abort();
      useAuthStore.getState().setConnectionError(null);
    };
  }, [credentials, logout]);
}
