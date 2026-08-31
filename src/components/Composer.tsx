import { ImagePlus, Send, Square, X } from "lucide-react";
import {
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { ChatPhase } from "../app/chat-reducer";
import type { UiCopy } from "../i18n/messages";
import {
  ImageProcessingError,
  processImage as defaultProcessImage,
  type ImageProcessingErrorCode,
  type ProcessedImage,
} from "../features/capture/image-processor";

export interface ComposerProps {
  copy: UiCopy;
  phase: ChatPhase;
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string) => void;
  onStop: () => void;
  disabled?: boolean;
  pendingImageDataUrl?: string;
  onRemoveImage?: () => void;
  onFocus?: () => void;
  onImage?: (image: ProcessedImage) => void;
  onError?: (code: ImageProcessingErrorCode) => void;
  processImage?: (file: File) => Promise<ProcessedImage>;
  imageDisabled?: boolean;
  onImageDisabled?: () => void;
}

export function Composer({
  copy,
  disabled = false,
  imageDisabled = false,
  onChange,
  onError,
  onFocus,
  onImage,
  onImageDisabled,
  onRemoveImage,
  onSend,
  onStop,
  pendingImageDataUrl,
  phase,
  processImage: processImageProp,
  value,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streaming = phase === "streaming";
  const unavailable = disabled || phase === "loading" || phase === "offline" || phase === "compressing";
  const canSend = value.trim().length > 0 || pendingImageDataUrl !== undefined;

  const submit = () => {
    if (!streaming && !unavailable && canSend) onSend(value);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (streaming) onStop();
    else submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    ) {
      return;
    }
    event.preventDefault();
    submit();
  };

  const handleFocus = () => {
    onFocus?.();
  };

  const handleImageFile = async (file: File) => {
    if (unavailable || streaming) return;
    if (imageDisabled) {
      onImageDisabled?.();
      return;
    }
    try {
      const process = processImageProp ?? defaultProcessImage;
      const processed = await process(file);
      onImage?.(processed);
    } catch (error) {
      onError?.(error instanceof ImageProcessingError ? error.code : "IMAGE_DECODE_FAILED");
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement | HTMLFormElement>) => {
    if (event.defaultPrevented || unavailable || streaming) return;
    const items = event.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            void handleImageFile(file);
            return;
          }
        }
      }
    }
    const files = event.clipboardData?.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith("image/")) {
          event.preventDefault();
          void handleImageFile(file);
          return;
        }
      }
    }
  };

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    if (event.defaultPrevented || unavailable || streaming) return;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith("image/")) {
          event.preventDefault();
          void handleImageFile(file);
          return;
        }
      }
    }
  };

  const handleDragOver = (event: DragEvent<HTMLFormElement>) => {
    if (event.defaultPrevented) return;
    if (event.dataTransfer?.types?.includes("Files")) {
      event.preventDefault();
    }
  };

  // 图片不可用时点击附件入口直接提示，不再打开系统文件选择器
  const handleAttachClick = () => {
    if (imageDisabled) {
      onImageDisabled?.();
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    // 复位 value 使再次选择同一文件仍触发 change
    event.currentTarget.value = "";
    if (file) void handleImageFile(file);
  };

  return (
    <form
      className="composer"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onPaste={handlePaste}
      onSubmit={handleSubmit}
    >
      {pendingImageDataUrl === undefined ? null : (
        <div className="composer__preview">
          <img alt="" src={pendingImageDataUrl} />
          <button
            aria-label={copy.removeImage}
            disabled={streaming}
            onClick={onRemoveImage}
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </div>
      )}
      <textarea
        ref={textareaRef}
        aria-label={copy.inputHint}
        autoCapitalize="sentences"
        autoCorrect="on"
        disabled={unavailable || streaming}
        enterKeyHint="send"
        inputMode="text"
        maxLength={4000}
        onChange={(event) => onChange(event.currentTarget.value)}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={phase === "compressing" ? copy.compressingContext : copy.inputHint}
        rows={1}
        spellCheck={false}
        value={value}
      />
      <div className="composer__actions">
        <button
          aria-label={copy.attachImage}
          className="composer__attach"
          disabled={unavailable || streaming}
          onClick={handleAttachClick}
          title={copy.attachImage}
          type="button"
        >
          <ImagePlus aria-hidden="true" size={18} />
        </button>
        <button
          aria-label={streaming ? copy.stop : copy.send}
          className={`composer__action${streaming ? " composer__action--stop" : ""}`}
          disabled={!streaming && (unavailable || !canSend)}
          title={streaming ? copy.stop : copy.send}
          type="submit"
        >
          {streaming ? (
            <Square aria-hidden="true" fill="currentColor" size={15} />
          ) : (
            <Send aria-hidden="true" size={17} />
          )}
        </button>
      </div>
      <input
        accept="image/*"
        aria-hidden="true"
        className="visually-hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        style={{ display: "none" }}
        tabIndex={-1}
        type="file"
      />
    </form>
  );
}
