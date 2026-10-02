import { useEffect, useState } from 'react';
import { Alert, Button, ConfigProvider, Dropdown, Grid, Layout, Tooltip, Typography, message, theme as antdTheme } from 'antd';
import { FontSizeOutlined, InfoCircleOutlined, MoonOutlined, PoweroffOutlined, SunOutlined } from '@ant-design/icons';
import ruRU from 'antd/locale/ru_RU';
import { ensureReceivingSettings } from './api/greenApi';
import { ChatList } from './components/ChatList';
import { ChatWindow } from './components/ChatWindow';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { LoginScreen } from './components/LoginScreen';
import { syncAccountChats } from './lib/sync';
import { useAuthStore } from './store/authStore';
import { useChatStore } from './store/chatStore';
import { useUiStore } from './store/uiStore';
import { useNotifications, useTabSync } from './hooks/useNotifications';
import type { Credentials } from './types';

function ChatScreen({ credentials }: { credentials: Credentials }) {
  const logout = useAuthStore((s) => s.logout);
  const connectionError = useAuthStore((s) => s.connectionError);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const selectChat = useChatStore((s) => s.selectChat);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const scale = useUiStore((s) => s.scale);
  const setScale = useUiStore((s) => s.setScale);
  const isMobile = !Grid.useBreakpoint().md;
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  useNotifications();

  useEffect(() => {
    // Чаты привязаны к инстансу: тот же логин - список сохраняется,
    // другой инстанс - чистится автоматически
    useChatStore.getState().setInstance(credentials.idInstance);
    ensureReceivingSettings(credentials).then(({ overwrittenWebhookUrl }) => {
      if (overwrittenWebhookUrl) {
        messageApi.warning(
          'На инстансе был настроен webhook - он отключён для работы приложения',
        );
      }
    });
    // Список чатов/последние сообщения/звонки при входе
    void syncAccountChats(credentials);
  }, [credentials, messageApi]);

  const showList = !isMobile || !activeChatId;
  const showChat = !isMobile || !!activeChatId;

  return (
    <div className="app-shell">
      {contextHolder}
      {connectionError && (
        <Alert type="warning" banner showIcon={false} message={connectionError} />
      )}
      <Layout className="app-layout">
        {showList && (
          <Layout.Sider width={isMobile ? '100%' : 320} className="app-sider">
            <div className="app-sider__header">
              <Typography.Title level={5} className="app-sider__title">
                Чаты
              </Typography.Title>
              <div>
                <Dropdown
                  trigger={['click']}
                  placement="bottomRight"
                  menu={{
                    selectable: true,
                    selectedKeys: [scale],
                    items: [
                      { key: 'small', label: 'Мелкий' },
                      { key: 'medium', label: 'Средний' },
                      { key: 'large', label: 'Крупный' },
                    ],
                    onClick: ({ key }) => setScale(key as typeof scale),
                  }}
                >
                  <Button
                    type="text"
                    icon={<FontSizeOutlined />}
                    aria-label="Размер интерфейса"
                  />
                </Dropdown>
                {/* На тач-устройствах тултипы залипают поверх UI - только на десктопе */}
                <Tooltip
                  title="Диагностика инстанса"
                  open={isMobile ? false : undefined}
                >
                  <Button
                    type="text"
                    icon={<InfoCircleOutlined />}
                    onClick={() => setDiagnosticsOpen(true)}
                  />
                </Tooltip>
                <Tooltip
                  title={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
                  open={isMobile ? false : undefined}
                >
                  <Button
                    type="text"
                    icon={theme === 'light' ? <MoonOutlined /> : <SunOutlined />}
                    onClick={toggleTheme}
                  />
                </Tooltip>
                <Tooltip title="Выйти" open={isMobile ? false : undefined}>
                  <Button
                    type="text"
                    danger
                    icon={<PoweroffOutlined />}
                    aria-label="Выйти"
                    onClick={logout}
                  />
                </Tooltip>
              </div>
            </div>
            <ChatList />
          </Layout.Sider>
        )}
        {showChat && (
          <Layout.Content>
            <ChatWindow onBack={isMobile ? () => selectChat(null) : undefined} />
          </Layout.Content>
        )}
      </Layout>
      <DiagnosticsModal
        credentials={credentials}
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
      />
    </div>
  );
}

export default function App() {
  const credentials = useAuthStore((s) => s.credentials);
  const theme = useUiStore((s) => s.theme);
  const scale = useUiStore((s) => s.scale);
  useTabSync();

  // data-атрибуты на <html> - первая отрисовка уже выставлена
  // синхронно в main.tsx, здесь только реагируем на смену
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.scale = scale;
  }, [theme, scale]);

  return (
    <ConfigProvider
      locale={ruRU}
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: '#00a884', colorInfo: '#00a884' },
      }}
    >
      {credentials ? <ChatScreen credentials={credentials} /> : <LoginScreen />}
    </ConfigProvider>
  );
}
