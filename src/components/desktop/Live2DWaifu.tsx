import { useEffect } from "react";

/**
 * Live2D 看板娘挂件层：动态注入 public/live2d/autoload.js（position=right），
 * 由其自建 `#waifu` DOM（视口右下角悬浮，toggle 按钮可收起/呼出）。
 *
 * - index.html 不再静态注入，挂件生命周期随桌面布局（认证后）而非页面加载；
 * - script 以 id 幂等守卫，React StrictMode 双挂载不重复注入；
 * - autoload.js 内部有 screen.width>=768 门槛，窄屏自动不加载；
 * - 挂件随应用生命周期常驻（DesktopLayout 不会卸载），故无需卸载清理。
 */
const WAIFU_SCRIPT_ID = "yachiyo-live2d-autoload";
const WAIFU_SCRIPT_SRC = "/live2d/autoload.js?position=right";

export function Live2DWaifu() {
  useEffect(() => {
    if (document.getElementById(WAIFU_SCRIPT_ID) !== null) return;
    const script = document.createElement("script");
    script.id = WAIFU_SCRIPT_ID;
    script.src = WAIFU_SCRIPT_SRC;
    document.body.appendChild(script);
  }, []);

  return null;
}
