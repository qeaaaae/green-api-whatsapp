import { Form, Input, Modal } from 'antd';
import { EditOutlined, FileTextOutlined, LinkOutlined } from '@ant-design/icons';
import { sendFileByUrl } from '../../api/greenApi';
import { replyQuoteOf, type AttachmentContext } from './types';

interface FileUrlModalProps extends AttachmentContext {
  open: boolean;
  onClose: () => void;
}

/** Отправка файла по URL: ссылка + имя файла с расширением + подпись */
export function FileUrlModal({
  open,
  onClose,
  credentials,
  chatId,
  replyTo,
  onSend,
}: FileUrlModalProps) {
  const [form] = Form.useForm();

  const submit = async () => {
    const v = await form.validateFields();
    const fileName: string = v.fileName.trim();
    const urlFile: string = v.url.trim();
    const isImage = /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif)$/i.test(fileName);
    onSend(
      {
        text: v.caption?.trim() || fileName,
        kind: isImage ? 'image' : 'file',
        url: urlFile,
        quote: replyQuoteOf(replyTo),
      },
      () =>
        sendFileByUrl(
          credentials,
          chatId,
          urlFile,
          fileName,
          v.caption?.trim() || undefined,
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
          <LinkOutlined className="attach-modal__icon" /> Файл по ссылке
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
          name="url"
          rules={[
            { required: true, message: 'Укажите ссылку на файл' },
            { type: 'url', message: 'Некорректная ссылка' },
          ]}
        >
          <Input
            prefix={<LinkOutlined className="attach-modal__input-icon" />}
            placeholder="https://example.com/file.pdf"
          />
        </Form.Item>
        <Form.Item
          name="fileName"
          rules={[{ required: true, message: 'Укажите имя файла с расширением' }]}
        >
          <Input
            prefix={<FileTextOutlined className="attach-modal__input-icon" />}
            placeholder="file.pdf"
          />
        </Form.Item>
        <Form.Item name="caption">
          <Input
            prefix={<EditOutlined className="attach-modal__input-icon" />}
            placeholder="Подпись (необязательно)"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
