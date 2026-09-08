# Agent Note: 纯本地用户设置与圆形无溢出头像裁剪

Status: implemented

## Problem

用户需要个性化配置与八千代互动时的个人身份，包括：
1. 自定义用户名与头像，且头像裁剪必须为圆形，裁切范围绝对不能超过原图尺寸（不得露出黑边、空白或背景底色）；
2. 隐私隔离约束：用户设置数据必须完全保存在本地（Local-only），严禁上传至云端服务器或数据库；
3. 设置面板入口需求：将设置弹窗左下角导航升级为用户设置卡片入口。

## Decision

- **本地存储与状态同步**（`src/services/user-settings.ts`）：
  - 数据模型包含 `username` 与 `avatar`（Base64 DataURL 或本地 URI）。
  - 存储使用 `localStorage`（键名 `yachiyo_local_user_settings`），读写增加容错降级，且在更新时通过自定义窗口事件 `yachiyo-user-settings-changed` 实现多组件即时响应。
  - 导出 `useLocalUserSettings` React Hook，无需全局重构 Reducer。
- **圆形头像裁剪器**（`src/components/settings/AvatarCropModal.tsx` & `src/styles/desktop.css`）：
  - 采用视口级无黑边全覆盖算法与大视口设计：
    - 视口尺寸拓展至 360px，裁剪圆半径扩大至 150px（直径整整 300px，提升超 50% 面积），弹窗卡片宽度提升至 420px，视觉大气清晰。
    - `baseScale = Math.max(VIEWPORT_SIZE / effectiveW, VIEWPORT_SIZE / effectiveH)`，保证图片在 1.0x 默认状态下短边完全填满 360x360 视口，彻底消除视口四周露出黑边的现象。
    - 动态平移 Clamp：`maxOffsetX = Math.max(0, (effectiveW * scale) / 2 - r)`，约束偏移量在 `[-maxOffsetX, maxOffsetX]`（Y 轴同理），确保无论如何平移，圆形裁剪区域 100% 被图片像素填满，绝不超出图片边界。
    - 交互支持指针捕获拖拽、滚轮缩放、平滑滑块（1.0x ~ 3.0x）与顺时针 90° 旋转（旋转后自适应重新计算基准比例）。
    - 离屏 Canvas 输出 256x256 优质 JPEG（0.88 质量）保证轻量与清晰度兼顾。
- **用户名注入**（`src/app/use-chat-controller.ts`）：
  - 在生成聊天请求的 `messages` 队列时，若配置了自定义用户名（非默认），在首条前置元数据中注入用户名称说明（支持中/日双语契约），让模型在自然回复中获知用户身份。
- **设置面板集成**（`src/components/settings/SettingsModal.tsx` & `src/styles/desktop.css`）：
  - 侧边栏底部 Tab 替换为用户卡片项，直接显示当前头像微缩图、用户名和“本地专属 · 个人资料”说明。
  - 右侧提供“个人资料”专属设置面板，提供头像更换、裁切与用户名修改功能。

## Consequences

- 用户拥有完全受控的本地个性化体验，无网络状态下也可无缝保存与更新。
- 本地设置完全与云端 API 隔离，无隐私泄露风险。
- 无论原图长宽比如何，裁剪框始终 100% 被图片像素填满，绝不会出现多余空白或黑底。

## Verification

- `npm run typecheck`：通过（覆盖三份 tsconfig）。
- `npm run lint`：通过（0 错误）。
- `npx vitest run src/components/settings/AvatarCropModal.test.tsx src/services/user-settings.test.ts src/components/settings/SettingsModal.test.tsx src/app/use-chat-controller.test.tsx`：49 个测试用例全部通过。
- `npm run test:unit`：35 个测试套件，306 个单元测试全部通过。
