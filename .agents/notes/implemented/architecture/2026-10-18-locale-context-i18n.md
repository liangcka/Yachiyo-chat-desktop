# Agent Note: 界面语言上下文与组件内双语文案

Status: implemented

## Problem

界面支持中文与日文，但只有 `UiCopy` 覆盖的少量文案会随语言切换。设置中心、MCP、模型管理、侧栏、顶栏、编辑器、成果面板等组件直接写死中文，切换到日文后大部分界面仍是中文。很多深层组件拿不到 `locale`，`EditorView` 甚至通过比较某条文案是否等于「チャット」来猜测语言。

## Decision

- 新增 `LocaleContext`（`src/i18n/locale-context.ts`），由 `App` 以 `controller.locale` 提供，深层组件用 `useLocale()` 读取，不再逐层透传。
- 只在单个组件内使用的文案就近维护：文案多的组件（设置中心、MCP 面板、模型管理面板）使用 `zhCopy` / `jaCopy: typeof zhCopy` 对象，由类型保证两种语言键一致；文案少的组件使用 `ja ? "…" : "…"`。跨组件共享的文案继续放在 `UiCopy`。
- 数据型文案随数据声明日文：技能定义的 `ja`、MCP 预设的 `ja`；厂商 Key 获取提示改为 `keySource`，由界面按语言拼接句子。
- 电脑控制遮罩是独立 webview，主窗口把语言写入同源 `localStorage` 的 `yachiyo-ui-locale` 供其读取。
- 发给模型的提示词、数据默认值（如默认用户名、已存会话标题）与内部错误不做翻译。

## Alternatives considered

- 引入 i18next 等国际化库：只有两种语言、无复数与格式化需求，额外依赖与键名管理成本高于收益。
- 把所有文案集中到 `UiCopy`：会让单一接口膨胀到数百个键，且大部分键只被一个组件使用。

## Consequences

- 新增界面文案时需同时提供中文与日文；`zhCopy`/`jaCopy` 形式会在缺键时报类型错误，三元形式需人工检查。
- 组件默认语言为中文，单元测试在未包裹 `LocaleContext` 时仍按中文断言。

## Verification

- `npm run typecheck`、`npm run lint`、`npm run test:unit` 通过；版本切换用例改为按语言断言。
- 浏览器中切换日文后截图检查欢迎页、设置中心（外观、模型、MCP、应用）与对话界面，未见残留中文界面文案（会话标题等已存数据除外）。
