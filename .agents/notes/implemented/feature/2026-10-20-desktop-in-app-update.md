# Agent Note: 桌面端应用内更新

Status: implemented

## Problem

桌面端启动时只会查询 GitHub 最新正式版并提示「前往下载」，用户需要打开浏览器、下载安装包、手动安装。

## Decision

- 接入 Tauri 官方 `tauri-plugin-updater` 与 `tauri-plugin-process`。点击「立即更新」后下载最新安装包、校验签名、安装并重启；Windows 使用 NSIS 的 `passive` 安装模式，只显示进度不需要交互。
- 签名公钥写在 `tauri.conf.json` 的 `plugins.updater.pubkey`，更新清单取 `releases/latest/download/latest.json`，即最新正式版附带的文件；草稿与预发布不会被拉取。
- 发布流程在配置了 `TAURI_SIGNING_PRIVATE_KEY`（及 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）时追加 `--config src-tauri/tauri.updater.conf.json`，生成签名与 `latest.json`；未配置时照常只出安装包，避免 CI 因缺少私钥失败。
- 是否有新版本仍由原有的 GitHub Releases 查询判断。真正安装前由 updater 再查一次清单：清单不存在（旧版本发布未签名）、离线时退回打开 Release 页面；下载中断或签名不符时提示失败并提供下载页入口，不会安装未通过校验的文件。
- 启动通知条与设置「应用 → 版本与更新」共用 `useAppUpdateInstaller`，显示下载百分比与安装状态，下载与安装期间不可关闭通知条。
- 插件 npm 包与 Rust crate 锁在同一小版本（updater 2.12、process 2.3），`@tauri-apps/api` 保持与 `tauri` crate 同为 2.11，否则 `tauri build` 的版本一致性检查会让发布失败。

## Alternatives considered

- 在 Rust 侧自行下载 Release 附件并启动安装程序：无需配置签名，但只依赖 TLS 保证安装包完整，被替换的附件会被直接执行。
- 继续只提供「前往下载」：不满足应用内更新的需求。

## Consequences

- 仓库维护者需要在 GitHub 仓库 Secrets 中配置 `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，此后发布的版本才带签名清单。私钥丢失后无法再为已安装的客户端签发更新，只能更换公钥并让用户手动安装一次。
- 应用内更新从「第一个带 updater 的版本」开始生效：更早的已安装版本没有 updater，仍需手动下载一次。
- 更新清单读取最新正式版，版本回退或撤回需要发布新的更高版本号。

## Verification

- `npm run typecheck`、`npm run lint`（仅保留既有的 `react-hooks/incompatible-library` 警告）：通过。
- `npm run test:unit`：通过，`DesktopUpdateNotice` 覆盖签名安装包下载进度与重启、无签名清单时打开下载页、校验失败时的提示与下载页入口。
- `cargo test --manifest-path src-tauri/Cargo.toml`：全部通过，编译期校验了插件配置与权限声明。
- 以生成的私钥执行 `tauri build --debug --bundles deb --config src-tauri/tauri.updater.conf.json`，确认构建通过版本一致性检查并生成更新签名。
