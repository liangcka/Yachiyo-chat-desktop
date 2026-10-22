const BOWL_CLASS = "yachiyo-whale-bowl";
const KNOCK_CLASS = "yachiyo-whale-bowl--knock";

const BOWL_SVG = `<svg viewBox="0 0 200 100" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="yachiyo-whale-bowl-shell" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#6b727c" />
      <stop offset="0.28" stop-color="#c9ced6" />
      <stop offset="0.42" stop-color="#f4f6f9" />
      <stop offset="0.62" stop-color="#aab0b9" />
      <stop offset="1" stop-color="#5d636c" />
    </linearGradient>
    <linearGradient id="yachiyo-whale-bowl-rim" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#5a6069" />
      <stop offset="0.4" stop-color="#e2e6ec" />
      <stop offset="1" stop-color="#565c65" />
    </linearGradient>
  </defs>
  <path d="M16 82C19 46 42 16 100 13c58 3 81 33 84 69z" fill="url(#yachiyo-whale-bowl-shell)" stroke="#4b5059" stroke-width="2" />
  <ellipse cx="100" cy="15" rx="44" ry="6" fill="#d7dbe1" stroke="#4b5059" stroke-width="1.6" />
  <path d="M60 30c-9 10-14 26-15 46" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.7" />
  <ellipse cx="100" cy="84" rx="97" ry="11" fill="url(#yachiyo-whale-bowl-rim)" stroke="#4b5059" stroke-width="2" />
</svg>`;

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
  bowl.innerHTML = BOWL_SVG;
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
