# Agent Note: 移除访问码门禁 — 实现全端直达与静默 Session 鉴权

Status: implemented

## Problem

原架构中，应用启动依赖前置验证码组件 `AccessGate`：
1. 用户首次或 Session 过期进入 Web 客户端时，界面会被 `AccessGate` 阻断，必须手动输入访问码（Access Code）方能进入主对话界面；
2. 即使用户已配置好本地 LLM Key 或在本地预览测试，未输入访问码前无法查看对话历史或进行界面交互；
3. 在设置中心中包含“退出登录”，但在无账号系统环境下退出登录仅清空本地 cookie，反向触发阻断性访问门禁，影响正常使用体验。

## Decision

彻底移除 `AccessGate` 前置门禁，将应用生命周期改为全端直达即开即用（Passwordless Direct Entry）：

1. **生命周期与初始化重构 (`App.tsx`)**：
   - 移除 `AccessGate` 阻断渲染分支与 `handleAuthenticate`。
   - `AuthenticationState` 简化为 `"checking" | "authenticated"`，初始即为 `"authenticated"`。
   - 统一 `initApp` 流程：组件挂载后立即并行初始化本地 LLM 配置、技能启用状态与联网搜索设置，确保界面第一时间可交互。
   - 静默会话维持（Silent Session）：联网环境下若存在后台 `services.session`，自动执行 `session.check()`，如需建立会话则后台静默申请，绝不阻断前台 UI。
   - 异常降级处理：遇到 `SESSION_REQUIRED` 错误时由后台发起静默重新建连，保持当前聊天界面与数据不丢失。
2. **设置中心与退出逻辑优化 (`SettingsModal.tsx`)**：
   - 移除账号 Tab 中突兀的“退出登录”按钮。
   - 在“存储与维护” Tab 中，将原“退出登录并清除凭据”精炼为“清除服务端凭据”，点击后调用 `services.session.signOut()` 清除 Cookie 并不跳转门禁，保持在主界面并提示已清除。
3. **测试套件同步与验证 (`app-flows.test.tsx`)**：
   - 更新集成流程测试，移除对输入访问码的依赖，验证免密直接进入主界面及切换语言、发送消息等核心流。
   - 将 `AccessGate` 的专属输入重试校验逻辑收拢至独立单测。

## Verification

- `npm run typecheck`：覆盖 app、node、functions 3 份 tsconfig，0 errors。
- `npm run lint`：0 errors。
- `npm run test:unit`：31 个测试套件，282 个用例全量通过。
- `npm run test:functions`：22 个测试套件，267 个用例全量通过。
