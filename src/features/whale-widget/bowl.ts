import bowlImageUrl from "./bowl.webp";

const BOWL_CLASS = "yachiyo-whale-bowl";
const KNOCK_CLASS = "yachiyo-whale-bowl--knock";

let audio: AudioContext | null = null;

/** 合成一声「铛」：铁盆的泛音不成整数倍，几组错开的正弦叠起来才像金属 */
function playClang(): void {
  if (typeof AudioContext === "undefined") return;
  audio ??= new AudioContext();
  const now = audio.currentTime;
  const out = audio.createGain();
  out.gain.setValueAtTime(0.16, now);
  out.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
  out.connect(audio.destination);
  for (const [frequency, level] of [[523, 1], [1247, 0.55], [2093, 0.3], [3150, 0.18]] as const) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.value = level;
    oscillator.connect(gain).connect(out);
    oscillator.start(now);
    oscillator.stop(now + 1.1);
  }
}

function knock(bowl: HTMLElement): void {
  bowl.classList.remove(KNOCK_CLASS);
  // 读一次布局让连点时动画从头播放
  void bowl.offsetWidth;
  bowl.classList.add(KNOCK_CLASS);
  playClang();
}

/**
 * 给小鲸鱼头顶扣一个铁盆，点一下会弹起晃动并「铛」一声。
 * 挂件节点由上游脚本异步创建，等 .dshwv-body 出现后把盆插在形象之后，随身体一起拖动、缩放与镜像；
 * 只有默认形象的头顶位置已知，换成其它角色时由样式隐藏。
 */
export function installWhaleBowl(): void {
  const bowl = document.createElement("button");
  bowl.type = "button";
  bowl.className = BOWL_CLASS;
  bowl.title = "敲一下";
  bowl.setAttribute("aria-label", "敲一下小鲸鱼头上的盆");
  const image = document.createElement("img");
  image.src = bowlImageUrl;
  image.alt = "";
  image.draggable = false;
  bowl.append(image);
  bowl.addEventListener("animationend", () => bowl.classList.remove(KNOCK_CLASS));

  const attach = (): boolean => {
    const body = document.querySelector(".dshwv-root > .dshwv-body");
    if (body === null) return false;
    body.append(bowl);
    return true;
  };
  if (!attach()) {
    const observer = new MutationObserver(() => {
      if (attach()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true });
  }

  // 上游在 document 捕获阶段按像素命中接管按下与点击（拖动鲸鱼），盆压在头发上会被吞掉；
  // window 捕获早于 document，落在盆上的事件在这里先认领
  const onBowl = (event: Event): boolean => event.target instanceof Node && bowl.contains(event.target);
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (!onBowl(event) || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  window.addEventListener(
    "click",
    (event) => {
      if (!onBowl(event)) return;
      event.stopPropagation();
      knock(bowl);
    },
    true,
  );
}
