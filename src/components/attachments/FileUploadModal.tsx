import { useState } from 'react';
import { Input, Modal } from 'antd';
import { EditOutlined, FileTextOutlined } from '@ant-design/icons';
import { sendFileByUpload } from '../../api/greenApi';
import type { MessageKind } from '../../types';
import { replyQuoteOf, type AttachmentContext } from './types';

interface FileUploadModalProps extends AttachmentContext {
  file: File | null;
  onClose: () => void;
}

/** Подтверждение отправки файла: имя/размер + подпись */
export function FileUploadModal({
  file,
  onClose,
  credentials,
  chatId,
  replyTo,
  onSend,
}: FileUploadModalProps) {
  const [caption, setCaption] = useState('');

  // Отмена тоже должна сбрасывать подпись - иначе она утечёт
  // в следующий выбранный файл
  const close = () => {
    setCaption('');
    onClose();
  };

  const submit = () => {
    if (!file) return;
    const name = file.name;
    const kind: MessageKind = file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('video/')
        ? 'video'
        : file.type.startsWith('audio/')
          ? 'audio'
          : 'file';
    onSend(
      {
        text: caption || name,
        kind,
        url: URL.createObjectURL(file),
        quote: replyQuoteOf(replyTo),
      },
      () =>
        sendFileByUpload(
          credentials,
          chatId,
          file,
          caption || undefined,
          replyTo?.id,
        ),
    );
    close();
  };

  return (
    <Modal
      title={
        <>
          <FileTextOutlined className="attach-modal__icon" /> Отправить файл
        </>
      }
      open={!!file}
      onOk={submit}
      onCancel={close}
      okText="Отправить"
      cancelText="Отмена"
    >
      <div className="attach-modal__file">
        <span className="attach-modal__file-icon">
          <FileTextOutlined />
        </span>
        <span className="attach-modal__file-info">
          <span className="attach-modal__file-name">{file?.name}</span>
          <span className="attach-modal__file-size">
            {file ? Math.ceil(file.size / 1024) : 0} КБ
          </span>
        </span>
      </div>
      <Input
        prefix={<EditOutlined className="attach-modal__input-icon" />}
        placeholder="Подпись (необязательно)"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
      />
    </Modal>
  );
}
