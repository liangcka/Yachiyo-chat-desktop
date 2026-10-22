import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "../../i18n/locale-context";

export interface ImageLightboxProps {
  src: string;
  onClose: () => void;
}

/**
 * 图片全屏预览。挂到 body 上：聊天栏设了 container-type，会成为 fixed 元素的包含块，
 * 留在原处时遮罩只能盖住中栏。
 */
export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  const ja = useLocale() === "ja-JP";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="artifact-lightbox"
      role="dialog"
      aria-label={ja ? "画像の全画面プレビュー" : "图像全屏预览"}
      aria-modal="true"
    >
      <button
        type="button"
        className="artifact-lightbox__backdrop"
        onClick={onClose}
        aria-label={ja ? "全画面プレビューを閉じる" : "关闭全屏预览"}
        tabIndex={-1}
      />
      <div className="artifact-lightbox__inner">
        <img src={src} alt={ja ? "プレビュー画像" : "预览图片"} className="artifact-lightbox__img" />
        <button
          type="button"
          className="artifact-lightbox__close"
          onClick={onClose}
          title={ja ? "プレビューを閉じる (Esc)" : "关闭预览 (Esc)"}
          aria-label={ja ? "全画面プレビューを閉じる" : "关闭全屏预览"}
        >
          <X size={16} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
