import { useState } from 'react';
import { Button, Card, Input, Typography, message } from 'antd';
import { getStateInstance } from '../api/greenApi';
import { useAuthStore } from '../store/authStore';

export function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const [idInstance, setIdInstance] = useState('');
  const [apiTokenInstance, setApiTokenInstance] = useState('');
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const submit = async () => {
    const creds = {
      idInstance: idInstance.trim(),
      apiTokenInstance: apiTokenInstance.trim(),
    };
    if (!creds.idInstance || !creds.apiTokenInstance) {
      messageApi.warning('Введите idInstance и apiTokenInstance');
      return;
    }
    setLoading(true);
    try {
      const { stateInstance } = await getStateInstance(creds);
      if (stateInstance !== 'authorized') {
        messageApi.error(
          `Инстанс не авторизован (${stateInstance}). Отсканируйте QR-код в личном кабинете GREEN-API.`,
        );
        return;
      }
      login(creds);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : 'Не удалось проверить инстанс',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      {contextHolder}
      <Card className="login-card">
        <Typography.Title level={3} className="login-title">
          GREEN-API WhatsApp
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="login-title">
          Учётные данные из личного кабинета GREEN-API
        </Typography.Paragraph>
        <Input
          placeholder="idInstance"
          value={idInstance}
          onChange={(e) => setIdInstance(e.target.value)}
          onPressEnter={submit}
          style={{ marginBottom: 12 }}
        />
        <Input.Password
          placeholder="apiTokenInstance"
          value={apiTokenInstance}
          onChange={(e) => setApiTokenInstance(e.target.value)}
          onPressEnter={submit}
          style={{ marginBottom: 16 }}
        />
        <Button type="primary" block onClick={submit} loading={loading}>
          Войти
        </Button>
      </Card>
    </div>
  );
}
