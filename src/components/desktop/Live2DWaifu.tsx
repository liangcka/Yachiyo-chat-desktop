import { useEffect } from "react";
import { useLocalUserSettings } from "../../services/user-settings";

/**
 * Live2D 看板娘挂件层：动态注入 public/live2d/autoload.js（position=right），
 * 由其自建 `#waifu` DOM（视口右下角悬浮，toggle 按钮可收起/呼出）。
 *
 * - 支持根据设置中心（LocalUserSettings.showLive2d）即时无刷新显隐控制；
 * - 禁用时不发起脚本注入；若已挂载则动态切换 display 样式；
 * - script 以 id 幂等守卫，React StrictMode 双挂载不重复注入；
 * - autoload.js 内部有 screen.width>=768 门槛，窄屏自动不加载。
 */
const WAIFU_SCRIPT_ID = "yachiyo-live2d-autoload";
const WAIFU_SCRIPT_SRC = "/live2d/autoload.js?position=right";

export interface Live2DWaifuProps {
  /** 显式覆盖开关（可选，缺省时读取 userSettings.showLive2d） */
  enabled?: boolean;
}

export function Live2DWaifu({ enabled: enabledProp }: Live2DWaifuProps = {}) {
  const [userSettings] = useLocalUserSettings();
  const isEnabled = enabledProp !== undefined ? enabledProp : userSettings.showLive2d;

  useEffect(() => {
    const waifuEl = document.getElementById("waifu");
    const waifuToggleEl = document.getElementById("waifu-toggle");

    if (!isEnabled) {
      // 禁用态：隐藏已生成的 DOM 节点，若尚未注入脚本则不注入
      if (waifuEl) waifuEl.style.display = "none";
      if (waifuToggleEl) waifuToggleEl.style.display = "none";
      return;
    }

    // 启用态：若已有节点则恢复可见性
    if (waifuEl) waifuEl.style.display = "";
    if (waifuToggleEl) waifuToggleEl.style.display = "";

    // 若尚未注入脚本，注入 autoload 脚本
    if (document.getElementById(WAIFU_SCRIPT_ID) === null) {
      const script = document.createElement("script");
      script.id = WAIFU_SCRIPT_ID;
      script.src = WAIFU_SCRIPT_SRC;
      document.body.appendChild(script);
    }
  }, [isEnabled]);

  return null;
}
