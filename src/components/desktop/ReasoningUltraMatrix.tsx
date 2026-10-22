import { useEffect, useRef } from "react";

const ROWS = 6;
const GAP = 1;
const FLOW_SPEED = 3.2; // 每秒流过的格数
const REVEAL_SECONDS = 0.5;

/** 由暗到亮的配色：左端靛蓝、中段紫到品红、只在紧挨拇指处转为粉白 */
const COLOR_STOPS: readonly (readonly [number, number, number, number])[] = [
  [0, 52, 30, 140],
  [0.4, 112, 48, 210],
  [0.68, 172, 86, 240],
  [0.88, 214, 158, 252],
  [1, 246, 238, 255],
];

function hash(x: number, y: number, z: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 二维值噪声，第三维用整数种子区分两层 */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const top = hash(ix, iy, seed) * (1 - ux) + hash(ix + 1, iy, seed) * ux;
  const bottom = hash(ix, iy + 1, seed) * (1 - ux) + hash(ix + 1, iy + 1, seed) * ux;
  return top * (1 - uy) + bottom * uy;
}

function colorAt(x: number, alpha: number): string {
  let index = 1;
  while (index < COLOR_STOPS.length - 1 && x > COLOR_STOPS[index]![0]) index += 1;
  const [x0, r0, g0, b0] = COLOR_STOPS[index - 1]!;
  const [x1, r1, g1, b1] = COLOR_STOPS[index]!;
  const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  return `rgba(${Math.round(r0 + (r1 - r0) * t)}, ${Math.round(g0 + (g1 - g0) * t)}, ${Math.round(b0 + (b1 - b0) * t)}, ${alpha.toFixed(3)})`;
}

/**
 * 绘制一帧点阵：密度从左到右爬升，右段铺满；噪声场随时间向右平移形成流动，
 * 中段叠加逐格闪烁的空洞与亮斑。reveal 从 0 到 1 时点阵自拇指一侧向左铺开
 */
function drawFrame(context: CanvasRenderingContext2D, width: number, height: number, time: number, reveal: number) {
  context.clearRect(0, 0, width, height);
  const pitch = height / ROWS;
  const size = pitch - GAP;
  const columns = Math.floor(width / pitch);
  const offsetX = width - columns * pitch;
  const tick = Math.floor(time * 12);
  for (let column = 0; column < columns; column += 1) {
    const x = columns <= 1 ? 1 : column / (columns - 1);
    const shown = smoothstep(1 - reveal * 1.3, 1.3 - reveal * 1.3, x);
    if (shown <= 0) continue;
    const ramp = smoothstep(0.1, 0.85, x);
    // 最左一段保持空白，之后才零星出现暗点
    const fade = smoothstep(0.08, 0.3, x);
    for (let row = 0; row < ROWS; row += 1) {
      const flow = valueNoise(column * 0.32 - time * FLOW_SPEED * 0.32, row * 0.55, 1);
      const detail = valueNoise(column * 0.8 - time * FLOW_SPEED * 0.8, row * 0.9 + time * 0.6, 2);
      const flicker = hash(column, row, tick);
      const energy = ramp * 1.15 + (flow - 0.5) * 1.1 + (detail - 0.5) * 0.6 + (flicker - 0.5) * 0.3 - 0.12;
      if (energy < 0.08) continue;
      const sparkle = flicker > 0.95 && x > 0.25 && x < 0.85;
      const alpha = Math.min(1, sparkle ? 1 : 0.18 + energy * 0.85) * shown * fade;
      context.fillStyle = sparkle ? `rgba(240, 160, 255, ${alpha.toFixed(3)})` : colorAt(Math.min(1, x + (flow - 0.5) * 0.15), alpha);
      context.fillRect(offsetX + column * pitch + GAP / 2, row * pitch + GAP / 2, size, size);
    }
  }
}

/** Ultra 档轨道里的流动点阵；只在挂载期间跑 rAF，系统减少动态效果时只画一帧静态图 */
export function ReasoningUltraMatrix() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas === null || canvas === undefined || context === null || context === undefined) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let frame = 0;

    const render = (now: number) => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      // 拖动时轨道填充宽度会变，按当前尺寸重设画布
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const elapsed = (now - start) / 1000;
      drawFrame(context, width, height, elapsed, reduceMotion ? 1 : Math.min(1, elapsed / REVEAL_SECONDS));
      if (!reduceMotion) frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvasRef} className="dsh-reasoning-select__matrix" aria-hidden="true" />;
}
