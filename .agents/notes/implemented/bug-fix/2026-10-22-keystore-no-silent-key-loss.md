# Agent Note: 桌面密钥存储不再静默丢 Key，Key 缺失单独报错

Status: implemented

## Problem

桌面网关从 `keys.enc` 取各厂商 API Key。原实现有三处会让 Key 永久丢失：

- 文件存在但读取或解密失败时，`read_data` 返回空数据。随后任何一次保存都把「空数据 + 新 Key」整体写回，其他厂商的 Key 全部丢失。
- 保存是「读出 → 修改 → 写回」，锁只覆盖缓存，不覆盖整个过程。并发保存不同厂商时，后写入的会覆盖先写入的。
- `fs::write` 直接截断原文件再写，中途退出会留下残缺文件。

Key 丢失后，IndexedDB 里仍保留占位符 `KEYSTORE_MANAGED_API_KEY`，界面看起来已配置。网关找不到 Key 时在流里发 `SESSION_REQUIRED`，前端把它当成未知上游错误，显示「暂时连接不上」和重试按钮；余额小鲸鱼同时取数失败，但上游挂件的气泡只显示省略号。

## Decision

- `KeyStore::load` 在持有缓存锁时读取：文件不存在视为空存储；读取出错（占用、权限等）返回错误，保存被拒绝，原文件保持不动；内容无法解密或解析时，原文件改名为 `keys.enc.unreadable` 留作恢复，再从空存储开始。
- `KeyStore::update` 在同一把锁内完成读、改、写。写入先写 `keys.enc.tmp` 再改名替换。
- 网关找不到 Key 时，对话流发 `API_KEY_MISSING`（普通对话与 Agent 两条路径）。前端映射为同名错误码，不可重试，提示用户在「设置 → 模型」重新填写 Key。
- 余额小鲸鱼宿主收到网关的 `API_KEY_MISSING` 或 `PROVIDER_AUTH_FAILED` 时，经 `WhaleHost.onKeyIssue` 通知应用弹出提示。同一问题持续存在时只提示一次，取数成功后重置。上游挂件脚本保持逐字节不改。

## Alternatives considered

- 读取失败时直接报错、不移走损坏文件：文件确实损坏或换了系统账户时，用户将永远无法再保存 Key。
- 在挂件气泡里显示失败原因：需要修改上游脚本，违反内置脚本逐字节不改的约定。

## Consequences

- 读取出错期间无法保存新 Key，保存接口返回 500，前端提示保存失败；文件恢复可读后即正常。
- `keys.enc.unreadable` 只保留最近一次无法解密的文件。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`（新增：无法解密的文件被移走保留、读取出错时拒绝覆盖、并发保存不丢 Key）
- `npm run test:unit`（新增：`API_KEY_MISSING` 流事件映射、小鲸鱼 Key 问题通知去重）
