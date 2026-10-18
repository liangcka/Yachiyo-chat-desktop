import { createContext, useContext } from "react";
import type { Locale } from "../domain/chat";

/** 主窗口把界面语言写入同源 localStorage 的键，供拿不到 React 状态的独立窗口（电脑控制遮罩）读取 */
export const LOCALE_MIRROR_KEY = "yachiyo-ui-locale";

/** 界面语言上下文：深层组件无需逐层透传 locale；未包裹时按默认中文渲染 */
export const LocaleContext = createContext<Locale>("zh-CN");

export function useLocale(): Locale {
  return useContext(LocaleContext);
}
