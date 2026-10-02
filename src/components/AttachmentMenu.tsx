import { useRef, useState } from 'react';
import { Button, Dropdown } from 'antd';
import {
  EnvironmentOutlined,
  FileTextOutlined,
  LinkOutlined,
  PaperClipOutlined,
  QuestionCircleOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { ChatMessage, Credentials } from '../types';
import { ContactModal } from './attachments/ContactModal';
import { FileUploadModal } from './attachments/FileUploadModal';
import { FileUrlModal } from './attachments/FileUrlModal';
import { LocationModal } from './attachments/LocationModal';
import { PollModal } from './attachments/PollModal';
import type { OutgoingDraft } from './attachments/types';

export type { OutgoingDraft };

interface AttachmentMenuProps {
  credentials: Credentials;
  chatId: string;
  /** Сообщение, на которое сейчас отвечаем (quotedMessageId) */
  replyTo?: ChatMessage | null;
  /** Добавить исходящее сообщение и запустить его отправку */
  onSend: (draft: OutgoingDraft, send: () => Promise<{ idMessage: string }>) => void;
}

type ModalKind = 'contact' | 'location' | 'poll' | 'fileUrl' | null;

export function AttachmentMenu({
  credentials,
  chatId,
  replyTo,
  onSend,
}: AttachmentMenuProps) {
  const [modal, setModal] = useState<ModalKind>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const close = () => setModal(null);
  const ctx = { credentials, chatId, replyTo, onSend };

  return (
    <>
      <Dropdown
        trigger={['click']}
        placement="topLeft"
        menu={{
          items: [
            { key: 'file', icon: <FileTextOutlined />, label: 'Файл' },
            { key: 'fileUrl', icon: <LinkOutlined />, label: 'Файл по ссылке' },
            { key: 'contact', icon: <UserOutlined />, label: 'Контакт' },
            { key: 'location', icon: <EnvironmentOutlined />, label: 'Локация' },
            { key: 'poll', icon: <QuestionCircleOutlined />, label: 'Опрос' },
          ],
          onClick: ({ key }) => {
            if (key === 'file') fileInputRef.current?.click();
            else setModal(key as ModalKind);
          },
        }}
      >
        <Button
          type="text"
          icon={<PaperClipOutlined />}
          aria-label="Прикрепить"
        />
      </Dropdown>
      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setFile(f);
          e.target.value = '';
        }}
      />

      <FileUploadModal file={file} onClose={() => setFile(null)} {...ctx} />
      <FileUrlModal open={modal === 'fileUrl'} onClose={close} {...ctx} />
      <ContactModal open={modal === 'contact'} onClose={close} {...ctx} />
      <LocationModal open={modal === 'location'} onClose={close} {...ctx} />
      <PollModal open={modal === 'poll'} onClose={close} {...ctx} />
    </>
  );
}
