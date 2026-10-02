import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseOutlined } from '@ant-design/icons';

const CLOSE_MS = 180;

interface ImageLightboxProps {
  src: string;
  caption?: string;
  onClose: () => void;
}

export function ImageLightbox({ src, caption, onClose }: ImageLightboxProps) {
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(onClose, CLOSE_MS);
  }, [closing, onClose]);

  // onClose по таймеру - при размонтировании отменяем
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  return createPortal(
    <div
      className={`lightbox${closing ? ' lightbox--closing' : ''}`}
      onClick={close}
      role="dialog"
      aria-modal="true"
    >
      <div className="lightbox__figure" onClick={(e) => e.stopPropagation()}>
        <img className="lightbox__img" src={src} alt={caption ?? ''} />
        {caption && <div className="lightbox__caption">{caption}</div>}
      </div>
      <button className="lightbox__close" onClick={close} aria-label="Закрыть">
        <CloseOutlined />
      </button>
    </div>,
    document.body,
  );
}
