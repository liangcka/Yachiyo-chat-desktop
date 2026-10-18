import { RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../../i18n/locale-context";

export interface AvatarCropModalProps {
  /** 选中的原始图片 Data URL 或 Object URL */
  imageSrc: string;
  /** 关闭或取消回调 */
  onClose: () => void;
  /** 确认裁剪后的 Data URL 回调 */
  onConfirm: (croppedDataUrl: string) => void;
  /** 弹窗是否开启 */
  open: boolean;
}

const VIEWPORT_SIZE = 320;
const CROP_RADIUS = 160;
const TARGET_SIZE = 512;

// 视口铺满缩放基准：保证图片短边在 1.0x 状态下填满整个圆形视口，杜绝周边黑边
const computeBaseScale = (w: number, h: number) => {
  if (!w || !h) return 1;
  return Math.max(VIEWPORT_SIZE / w, VIEWPORT_SIZE / h);
};

export function AvatarCropModal({
  imageSrc,
  onClose,
  onConfirm,
  open,
}: AvatarCropModalProps) {
  const ja = useLocale() === "ja-JP";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);

  const [zoom, setZoom] = useState(1.0);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const offsetStartRef = useRef({ x: 0, y: 0 });

  // 加载图片对象并重置控制参数
  useEffect(() => {
    if (!open || !imageSrc) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setImageObj(img);
      setZoom(1.0);
      setRotation(0);
      setOffset({ x: 0, y: 0 });
    };
    img.src = imageSrc;
  }, [open, imageSrc]);

  // 监听 Escape 键退出
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // 计算当前旋转方向下的图片有效投影宽高
  const imgW = imageObj ? imageObj.naturalWidth || imageObj.width : 0;
  const imgH = imageObj ? imageObj.naturalHeight || imageObj.height : 0;
  const isRotatedQuarter = rotation === 90 || rotation === 270;
  const effW = isRotatedQuarter ? imgH : imgW;
  const effH = isRotatedQuarter ? imgW : imgH;

  const r = CROP_RADIUS;
  const baseScale = useMemo(() => {
    return computeBaseScale(effW, effH);
  }, [effW, effH]);

  const currentScale = baseScale * zoom;

  // 边界截断函数：确保平移后圆形裁剪框始终处于图片像素内部，绝不超出图片且无黑边
  const clampOffset = useCallback(
    (
      rawOffset: { x: number; y: number },
      scale: number,
      effectiveW: number,
      effectiveH: number,
    ) => {
      const halfW = (effectiveW * scale) / 2;
      const halfH = (effectiveH * scale) / 2;
      const maxOffsetX = Math.max(0, halfW - r);
      const maxOffsetY = Math.max(0, halfH - r);
      return {
        x: Math.min(Math.max(rawOffset.x, -maxOffsetX), maxOffsetX),
        y: Math.min(Math.max(rawOffset.y, -maxOffsetY), maxOffsetY),
      };
    },
    [r],
  );

  // 绘制视口：DPR 超级采样高保真渲染，所见即所得
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageObj) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 动态获取 DPR，至少保证 2x 超级采样，消除高分屏模糊
    const dpr = typeof window !== "undefined" ? Math.max(2, window.devicePixelRatio || 1) : 2;
    const physicalSize = Math.round(VIEWPORT_SIZE * dpr);
    if (canvas.width !== physicalSize || canvas.height !== physicalSize) {
      canvas.width = physicalSize;
      canvas.height = physicalSize;
    }

    const W = VIEWPORT_SIZE;
    const H = VIEWPORT_SIZE;
    const cx = W / 2;
    const cy = H / 2;

    ctx.save();
    // 缩放到高清视口物理像素
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // 清屏
    ctx.clearRect(0, 0, W, H);

    // 确保平移处于安全约束内
    const safeOffset = clampOffset(offset, currentScale, effW, effH);

    // 1. 圆形剪裁区域（杜绝任何外部方框黑边）
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // 2. 高质量绘制图像内容
    ctx.translate(cx + safeOffset.x, cy + safeOffset.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(currentScale, currentScale);
    ctx.drawImage(imageObj, -imgW / 2, -imgH / 2, imgW, imgH);
    ctx.restore();

    // 3. 绘制圆形边缘精致指示光圈
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }, [imageObj, zoom, rotation, offset, currentScale, effW, effH, imgW, imgH, r, clampOffset]);

  if (!open) return null;

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    offsetStartRef.current = { ...offset };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const rawX = offsetStartRef.current.x + dx;
    const rawY = offsetStartRef.current.y + dy;
    setOffset(clampOffset({ x: rawX, y: rawY }, currentScale, effW, effH));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    const nextZoom = Math.min(Math.max(Number((zoom + delta).toFixed(2)), 1.0), 3.0);
    setZoom(nextZoom);
    setOffset((prev) => clampOffset(prev, baseScale * nextZoom, effW, effH));
  };

  const handleZoomChange = (nextZoom: number) => {
    setZoom(nextZoom);
    setOffset((prev) => clampOffset(prev, baseScale * nextZoom, effW, effH));
  };

  const handleRotate = () => {
    const nextRot = (rotation + 90) % 360;
    const nextRotatedQuarter = nextRot === 90 || nextRot === 270;
    const nextEffW = nextRotatedQuarter ? imgH : imgW;
    const nextEffH = nextRotatedQuarter ? imgW : imgH;
    const nextBaseScale = computeBaseScale(nextEffW, nextEffH);
    const nextScale = nextBaseScale * zoom;
    setRotation(nextRot);
    setOffset((prev) => clampOffset(prev, nextScale, nextEffW, nextEffH));
  };

  const handleConfirmCrop = () => {
    if (!imageObj) return;
    const outCanvas = document.createElement("canvas");
    outCanvas.width = TARGET_SIZE;
    outCanvas.height = TARGET_SIZE;
    const outCtx = outCanvas.getContext("2d");
    if (!outCtx) return;

    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = "high";

    const scaleRatio = TARGET_SIZE / (2 * r);
    const safeOffset = clampOffset(offset, currentScale, effW, effH);

    outCtx.save();
    outCtx.translate(TARGET_SIZE / 2, TARGET_SIZE / 2);
    outCtx.scale(scaleRatio, scaleRatio);
    outCtx.translate(safeOffset.x, safeOffset.y);
    outCtx.rotate((rotation * Math.PI) / 180);
    outCtx.scale(currentScale, currentScale);
    outCtx.drawImage(imageObj, -imgW / 2, -imgH / 2, imgW, imgH);
    outCtx.restore();

    const croppedDataUrl = outCanvas.toDataURL("image/jpeg", 0.95);
    onConfirm(croppedDataUrl);
  };

  return (
    <div
      className="avatar-crop-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={ja ? "アバターを円形に切り抜く" : "裁剪圆形头像"}
    >
      <button
        type="button"
        className="avatar-crop-modal-backdrop"
        onClick={onClose}
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className="avatar-crop-modal-card">
        <header className="avatar-crop-modal-header">
          <h4 className="avatar-crop-modal-title">{ja ? "アバターを円形に切り抜く" : "裁剪圆形头像"}</h4>
          <button
            type="button"
            className="avatar-crop-modal-close"
            onClick={onClose}
            aria-label={ja ? "切り抜きを閉じる" : "关闭裁剪"}
          >
            <X size={16} />
          </button>
        </header>

        <div className="avatar-crop-canvas-wrapper">
          <canvas
            ref={canvasRef}
            width={VIEWPORT_SIZE}
            height={VIEWPORT_SIZE}
            className="avatar-crop-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
            title={ja ? "ドラッグで位置を調整、スクロールで拡大縮小" : "拖动调整位置，滑动缩放"}
          />
        </div>

        <div className="avatar-crop-controls">
          <div className="avatar-crop-zoom-row">
            <ZoomOut
              size={15}
              className="avatar-crop-icon-btn"
              onClick={() => handleZoomChange(Math.max(zoom - 0.1, 1.0))}
            />
            <input
              type="range"
              aria-label={ja ? "拡大率" : "缩放比例"}
              min="1.0"
              max="3.0"
              step="0.05"
              value={zoom}
              onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
              className="avatar-crop-range"
            />
            <ZoomIn
              size={15}
              className="avatar-crop-icon-btn"
              onClick={() => handleZoomChange(Math.min(zoom + 0.1, 3.0))}
            />
            <button
              type="button"
              className="avatar-crop-rotate-btn"
              onClick={handleRotate}
              title={ja ? "時計回りに 90° 回転" : "顺时针旋转90°"}
            >
              <RotateCw size={14} />
            </button>
          </div>
          <span className="avatar-crop-hint">
            {ja ? "切り抜き範囲は画像内に収まります。ドラッグで位置を調整できます" : "裁切范围限制在图片内，拖动调整位置"}
          </span>
        </div>

        <footer className="avatar-crop-modal-footer">
          <button
            type="button"
            className="settings-btn settings-btn--ghost"
            onClick={onClose}
          >
            {ja ? "キャンセル" : "取消"}
          </button>
          <button
            type="button"
            className="settings-btn settings-btn--primary"
            onClick={handleConfirmCrop}
          >
            {ja ? "切り抜きを完了" : "完成裁剪"}
          </button>
        </footer>
      </div>
    </div>
  );
}
