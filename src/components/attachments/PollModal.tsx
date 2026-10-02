import { Button, Form, Input, Modal, Switch } from 'antd';
import {
  MinusCircleOutlined,
  OrderedListOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import { sendPoll } from '../../api/greenApi';
import { replyQuoteOf, type AttachmentContext } from './types';

interface PollModalProps extends AttachmentContext {
  open: boolean;
  onClose: () => void;
}

/** Опрос: вопрос + динамический список вариантов + мультивыбор */
export function PollModal({
  open,
  onClose,
  credentials,
  chatId,
  replyTo,
  onSend,
}: PollModalProps) {
  const [form] = Form.useForm();

  const submit = async () => {
    const v = await form.validateFields();
    const options: string[] = (v.options ?? []).filter((o: string) => o?.trim());
    onSend(
      {
        text: v.question,
        kind: 'poll',
        extra: { options },
        quote: replyQuoteOf(replyTo),
      },
      () =>
        sendPoll(
          credentials,
          chatId,
          v.question,
          options,
          !!v.multiple,
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
          <QuestionCircleOutlined className="attach-modal__icon" /> Создать опрос
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
          name="question"
          rules={[{ required: true, message: 'Введите вопрос' }]}
        >
          <Input
            prefix={<QuestionCircleOutlined className="attach-modal__input-icon" />}
            placeholder="Вопрос"
          />
        </Form.Item>
        <Form.List
          name="options"
          initialValue={['', '']}
          rules={[
            {
              validator: async (_, value: string[]) => {
                if ((value ?? []).filter((o) => o?.trim()).length < 2) {
                  throw new Error('Минимум два варианта');
                }
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <>
              {fields.map((field) => (
                <Form.Item key={field.key} required style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Form.Item
                      name={field.name}
                      noStyle
                      rules={[{ required: true, message: 'Пустой вариант' }]}
                    >
                      <Input
                        prefix={<OrderedListOutlined className="attach-modal__input-icon" />}
                        placeholder={`Вариант ${field.name + 1}`}
                      />
                    </Form.Item>
                    {fields.length > 2 && (
                      <Button
                        type="text"
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    )}
                  </div>
                </Form.Item>
              ))}
              <Form.ErrorList errors={errors} />
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => add('')}
                block
              >
                Добавить вариант
              </Button>
            </>
          )}
        </Form.List>
        <Form.Item
          name="multiple"
          label="Можно выбирать несколько вариантов"
          valuePropName="checked"
          style={{ marginTop: 16 }}
        >
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
