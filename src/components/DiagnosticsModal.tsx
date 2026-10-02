import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Descriptions,
  List,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Typography,
  message,
} from 'antd';
import {
  clearMessagesQueue,
  clearWebhooksQueue,
  getMessagesCount,
  getStateInstanceHistory,
  getWaSettings,
  getWebhooksCount,
  logoutInstance,
  reboot,
  showMessagesQueue,
  type QueuedMessage,
  type StateInstanceRecord,
  type WaSettings,
} from '../api/greenApi';
import { formatMessageDate, formatMessageTime } from '../lib/format';
import { useAuthStore } from '../store/authStore';
import type { Credentials } from '../types';

interface DiagnosticsModalProps {
  credentials: Credentials;
  open: boolean;
  onClose: () => void;
}

const formatTs = (ts?: number) =>
  ts ? `${formatMessageDate(ts)}, ${formatMessageTime(ts)}` : '-';

// Превью зависшего исходящего: тип + куда + содержимое
function queueItemText(m: QueuedMessage): string {
  const target = m.body?.chatId ?? '';
  const content = m.body?.message ?? m.body?.fileName ?? m.body?.urlFile ?? '';
  return [m.type, target, content].filter(Boolean).join(' · ');
}

export function DiagnosticsModal({
  credentials,
  open,
  onClose,
}: DiagnosticsModalProps) {
  const logout = useAuthStore((s) => s.logout);
  const [loading, setLoading] = useState(false);
  const [wa, setWa] = useState<WaSettings | null>(null);
  const [history, setHistory] = useState<StateInstanceRecord[]>([]);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [webhooksCount, setWebhooksCount] = useState<number | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const load = useCallback(async () => {
    setLoading(true);
    const [waR, histR, qR, qcR, wcR] = await Promise.allSettled([
      getWaSettings(credentials),
      getStateInstanceHistory(credentials, 20),
      showMessagesQueue(credentials),
      getMessagesCount(credentials),
      getWebhooksCount(credentials),
    ]);
    if (waR.status === 'fulfilled') setWa(waR.value);
    if (histR.status === 'fulfilled') setHistory(histR.value);
    if (qR.status === 'fulfilled') setQueue(qR.value);
    if (qcR.status === 'fulfilled') setQueueCount(qcR.value.count);
    if (wcR.status === 'fulfilled') setWebhooksCount(wcR.value.count);
    setLoading(false);
  }, [credentials]);

  useEffect(() => {
    if (!open) return;
    // Отложенный запуск, чтобы не дергать setState синхронно в эффекте
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [open, load]);

  const clearOutgoing = async () => {
    try {
      await clearMessagesQueue(credentials);
      messageApi.success('Очередь исходящих очищена');
      void load();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : 'Не удалось очистить');
    }
  };

  const clearIncoming = async () => {
    try {
      const r = await clearWebhooksQueue(credentials);
      if (r.isCleared) {
        messageApi.success('Очередь уведомлений очищена');
      } else {
        // GREEN-API ограничивает очистку раз в минуту
        messageApi.warning(
          r.leftTime
            ? `Очистка доступна через ${r.leftTime} сек`
            : (r.reason ?? 'Не удалось очистить'),
        );
      }
      void load();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : 'Не удалось очистить');
    }
  };

  const doReboot = async () => {
    try {
      await reboot(credentials);
      messageApi.success('Инстанс перезапускается');
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : 'Не удалось перезапустить');
    }
  };

  const doLogout = async () => {
    try {
      await logoutInstance(credentials);
    } finally {
      // Сессия WhatsApp завершена - инстанс потребует QR заново,
      // наши креды для поллинга бесполезны
      logout();
    }
  };

  return (
    <Modal
      title="Диагностика инстанса"
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
    >
      {contextHolder}
      <Spin spinning={loading}>
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="Номер">{wa?.phone || '-'}</Descriptions.Item>
          <Descriptions.Item label="Состояние">
            {wa?.stateInstance || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Синхронизация истории">
            {wa?.historySyncProgress != null
              ? `${wa.historySyncProgress}%`
              : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Устройство">
            {wa?.deviceId || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Исходящие в очереди">
            {queueCount ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Уведомления в очереди">
            {webhooksCount ?? '-'}
          </Descriptions.Item>
        </Descriptions>

        {queue.length > 0 && (
          <>
            <Typography.Title level={5} style={{ marginTop: 16 }}>
              Очередь исходящих
            </Typography.Title>
            <List
              size="small"
              bordered
              dataSource={queue.slice(0, 20)}
              renderItem={(m) => (
                <List.Item>
                  <Typography.Text ellipsis className="diag-queue__item">
                    {queueItemText(m)}
                  </Typography.Text>
                </List.Item>
              )}
            />
          </>
        )}

        {history.length > 0 && (
          <>
            <Typography.Title level={5} style={{ marginTop: 16 }}>
              История состояний
            </Typography.Title>
            <List
              size="small"
              bordered
              dataSource={history}
              renderItem={(s) => (
                <List.Item>
                  <Typography.Text>
                    {s.stateInstance} · {formatTs(s.timestamp)}
                    {s.phoneNumber ? ` · ${s.phoneNumber}` : ''}
                  </Typography.Text>
                </List.Item>
              )}
            />
          </>
        )}

        <Space wrap style={{ marginTop: 16 }}>
          <Button onClick={() => void load()}>Обновить</Button>
          <Popconfirm
            title="Зависшие исходящие сообщения будут удалены без отправки"
            onConfirm={() => void clearOutgoing()}
          >
            <Button>Очистить исходящие</Button>
          </Popconfirm>
          <Popconfirm
            title="Необработанные входящие уведомления будут удалены"
            onConfirm={() => void clearIncoming()}
          >
            <Button>Очистить уведомления</Button>
          </Popconfirm>
          <Popconfirm
            title="Перезапустить инстанс GREEN-API?"
            onConfirm={() => void doReboot()}
          >
            <Button>Перезапуск</Button>
          </Popconfirm>
          <Popconfirm
            title="Инстанс будет разлогинен - понадобится сканировать QR заново"
            okButtonProps={{ danger: true }}
            onConfirm={() => void doLogout()}
          >
            <Button danger>Разлогинить инстанс</Button>
          </Popconfirm>
        </Space>
      </Spin>
    </Modal>
  );
}
