import { Form, Input, InputNumber, Modal } from 'antd';
import {
  CompassOutlined,
  EditOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons';
import { sendLocation } from '../../api/greenApi';
import { replyQuoteOf, type AttachmentContext } from './types';

interface LocationModalProps extends AttachmentContext {
  open: boolean;
  onClose: () => void;
}

/** Геолокация: широта/долгота + название места */
export function LocationModal({
  open,
  onClose,
  credentials,
  chatId,
  replyTo,
  onSend,
}: LocationModalProps) {
  const [form] = Form.useForm();

  const submit = async () => {
    const v = await form.validateFields();
    onSend(
      {
        text: v.name || `Геолокация: ${v.latitude}, ${v.longitude}`,
        kind: 'location',
        extra: {
          latitude: v.latitude,
          longitude: v.longitude,
          locationName: v.name || undefined,
        },
        quote: replyQuoteOf(replyTo),
      },
      () =>
        sendLocation(
          credentials,
          chatId,
          v.latitude,
          v.longitude,
          v.name || undefined,
          replyTo?.id,
        ),
    );
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title={
        <>
          <EnvironmentOutlined className="attach-modal__icon" /> Отправить локацию
        </>
      }
      open={open}
      onOk={submit}
      onCancel={onClose}
      okText="Отправить"
      cancelText="Отмена"
    >
      <Form form={form} layout="vertical" preserve={false} requiredMark={false}>
        <Form.Item
          name="latitude"
          rules={[{ required: true, message: 'Укажите широту' }]}
        >
          <InputNumber
            style={{ width: '100%' }}
            step={0.000001}
            min={-90}
            max={90}
            placeholder="Широта - 55.7558"
            prefix={<CompassOutlined className="attach-modal__input-icon" />}
          />
        </Form.Item>
        <Form.Item
          name="longitude"
          rules={[{ required: true, message: 'Укажите долготу' }]}
        >
          <InputNumber
            style={{ width: '100%' }}
            step={0.000001}
            min={-180}
            max={180}
            placeholder="Долгота - 37.6173"
            prefix={<CompassOutlined className="attach-modal__input-icon" />}
          />
        </Form.Item>
        <Form.Item name="name">
          <Input
            prefix={<EditOutlined className="attach-modal__input-icon" />}
            placeholder="Название места (необязательно)"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
