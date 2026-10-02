import { Form, Input, Modal } from 'antd';
import { PhoneOutlined, ShopOutlined, UserOutlined } from '@ant-design/icons';
import { sendContact } from '../../api/greenApi';
import { formatPhoneInput, toChatId } from '../../lib/chatId';
import { replyQuoteOf, type AttachmentContext } from './types';

interface ContactModalProps extends AttachmentContext {
  open: boolean;
  onClose: () => void;
}

/** Карточка контакта: телефон + имя/фамилия/компания -> sendContact */
export function ContactModal({
  open,
  onClose,
  credentials,
  chatId,
  replyTo,
  onSend,
}: ContactModalProps) {
  const [form] = Form.useForm();

  const submit = async () => {
    const v = await form.validateFields();
    const phone = toChatId(v.phone)?.replace('@c.us', '');
    if (!phone) return;
    const contactName = [v.firstName, v.lastName].filter(Boolean).join(' ') || undefined;
    onSend(
      {
        text: `Контакт: ${contactName || `+${phone}`}`,
        kind: 'contact',
        extra: { contactName, phone: `+${phone}`, company: v.company || undefined },
        quote: replyQuoteOf(replyTo),
      },
      () =>
        sendContact(
          credentials,
          chatId,
          {
            phoneContact: Number(phone),
            firstName: v.firstName || undefined,
            lastName: v.lastName || undefined,
            company: v.company || undefined,
          },
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
          <UserOutlined className="attach-modal__icon" /> Отправить контакт
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
          name="phone"
          rules={[{ required: true, message: 'Укажите телефон' }]}
        >
          <Input
            prefix={<PhoneOutlined className="attach-modal__input-icon" />}
            placeholder="+7 (999) 123-45-67"
            onChange={(e) =>
              form.setFieldValue('phone', formatPhoneInput(e.target.value))
            }
          />
        </Form.Item>
        <Form.Item name="firstName">
          <Input
            prefix={<UserOutlined className="attach-modal__input-icon" />}
            placeholder="Имя"
          />
        </Form.Item>
        <Form.Item name="lastName">
          <Input
            prefix={<UserOutlined className="attach-modal__input-icon" />}
            placeholder="Фамилия"
          />
        </Form.Item>
        <Form.Item name="company">
          <Input
            prefix={<ShopOutlined className="attach-modal__input-icon" />}
            placeholder="Компания (необязательно)"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
