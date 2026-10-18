# Agent Note: 桌面端 API Key 仅存系统加密存储

Status: implemented

## Problem

桌面端的 API Key 同时存在两处：本地网关的 `keys.enc` 用 `SHA256(固定盐 + USERNAME + COMPUTERNAME)` 派生的 AES 密钥加密，这些输入公开可得，等同于可逆混淆；前端 IndexedDB 的 `llmSettings` 表又以明文保存同一份 Key，并在每次请求中随请求体发给网关。任何能读取用户目录的程序或离线拷贝磁盘都能直接拿到 Key。

## Decision

- Windows 下 `KeyStore` 用 DPAPI（`CryptProtectData`，当前登录用户作用域）加密整个 Key 映射，文件以 `YKD1` 文件头标识。读取到无文件头的旧格式时，用旧机器密钥解密后立即按 DPAPI 重新写回。其他平台沿用原 AES-GCM 实现。
- 桌面端保存模型配置时，先 `await` 写入网关 `/api/keys`，成功后 IndexedDB 只记录占位符 `KEYSTORE_MANAGED_API_KEY`；写入失败则整条配置不落库并向用户报错。
- 启动时 `migrateKeysToKeystore` 把旧版本留在 IndexedDB 的明文 Key 逐条迁入网关并替换为占位符；单条失败保留原记录，下次启动重试。
- `streamChat` 遇到占位符时不在请求体携带 `apiKey`，网关按厂商从 `KeyStore` 读取。
- 模型设置面板不回显已保存的 Key：输入框留空保存即沿用，填写新值则覆盖。
- Web 与 APK 轨道不变。

## Alternatives considered

- Windows 凭据管理器（`keyring`）：单条凭据上限 2560 字节，多厂商 Key 合并存储可能超限；按厂商拆分条目又需要额外的枚举与清理逻辑。DPAPI 无长度限制，且沿用现有单文件结构。
- 仅替换网关侧加密：IndexedDB 明文副本仍在，实际防护效果不变。
- 用随机密钥文件替代机器派生密钥：密钥与密文放在同一目录，防护等同于不加密。

## Consequences

- DPAPI 防的是其他用户账户与离线拷贝；同一用户身份运行的程序仍可调用解密接口，这是所有用户态本地存储的共同边界。
- 若 `keys.enc` 被删除或在其他账户下打开，网关取不到 Key，对话返回 `SESSION_REQUIRED`，界面引导用户重新填写。
- 联网搜索服务的 Key 仍保存在 IndexedDB，后续可按同一模式迁移。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`：新增新实例重读与旧格式迁移用例。
- `cargo check --target x86_64-pc-windows-gnu --lib --tests`：DPAPI 分支编译通过；Windows 运行时用例由 CI 的 Windows 任务执行。
- `npm run test:unit`：新增桌面端保存只留占位符、网关拒绝时不落库、旧明文迁移、请求体剥离占位符用例。
