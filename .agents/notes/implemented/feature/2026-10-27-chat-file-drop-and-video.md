# Agent Note: 聊天区拖入文件与内联视频

Status: implemented

## Problem

桌面端只能通过「添加文件或图片」按钮选择附件，输入框上的 HTML5 `onDrop` 在 Tauri 里收不到系统文件：webview 的原生拖放（`dragDropEnabled` 缺省开启）会拦截拖入，前端拿不到 `File`。消息里也无法查看视频，本地视频路径和远程视频链接都只显示为文字。

## Decision

- **拖入入口**：`useFileDrop`（`src/views/desktop/use-file-drop.ts`）统一两端。桌面端订阅 `getCurrentWebview().onDragDropEvent`（经 `desktop-bridge.onDesktopFileDrop`），enter 时高亮放置区，drop 时交出路径，落点在窗口任意位置都算；网页端在 `.desktop-main-chat` 上挂 HTML5 事件并按 dragenter/leave 计数。输入区不可用（加载、离线、压缩中）时不高亮、不接收。窗口配置保持 `dragDropEnabled` 缺省值，因为只有原生事件能给出文件路径。
- **读取拖入的文件**：路径先经 Rust 命令 `allow_asset_files` 放行到 asset 协议（只接受存在的绝对路径普通文件，返回 `path/name/size`），再 `fetch(convertFileSrc(path))` 读成 `File`，交给与选择文件相同的 `attachFiles`：图片走 `processImage` → `pendingImage` → `imageDataUrl`，文本走 `readTextAttachment`。超过图片源文件上限（15 MB，也是所有附件里最大的上限）的文件不读入内存，直接提示。
- **视频附件**：视频按扩展名（mp4/m4v/mov/webm/ogv/mkv）识别，只记路径，不读内容。发送时与文本附件一样拼到消息末尾，格式为 `【视频 文件名】\n路径`，模型拿到本地路径后可用工具处理该文件。
- **用户消息里的附件卡片**：`splitMessageAttachments` 是 `appendAttachments` 的逆过程，从末尾拆回文本与视频附件。`MessageBubble` 把它们和图片一样渲染成气泡外的独立卡片：文本文件是可展开的 `<details>` 卡片，视频是内联播放器。文字气泡只保留正文，没有正文时不渲染气泡。存储里的消息原文不变，编辑时仍编辑完整文本。
- **消息里的视频链接**：`parseVideoLine` 识别段落与列表项中的 http(s)、`file://` 和本地绝对路径视频链接（整行或反引号包裹时允许路径含空格）。`MarkdownContent` 在该行后接 `ChatVideo`，整行只有链接时不再重复显示路径文字。`ChatVideo` 对本地路径先调 `allow_asset_files` 再加载 asset 地址，失败或网页端无法加载时退回为「无法加载视频：原链接」。
- **配置**：`tauri` 开启 `protocol-asset` feature；`security.assetProtocol` 为 `{ enable: true, scope: [] }`，不静态放行任何目录，只在运行时逐个放行文件。CSP 新增 `media-src 'self' blob: asset: http://asset.localhost https:`，`connect-src` 补 `asset: http://asset.localhost` 供 fetch 读取拖入的文件。

## Alternatives considered

- **关闭 `dragDropEnabled` 走 HTML5 drop**：能直接拿到 `File`，但 WebView2 不暴露文件路径，视频就只能整段读进内存或用一次性的 blob URL，刷新后消息里的视频失效，模型也拿不到可操作的路径。
- **静态 asset scope（如 `$HOME/**`）**：配置最简单，但任何渲染进页面的 asset 地址都能读用户目录下的任意文件。按文件运行时放行，范围限定在用户拖入的文件和消息里引用的视频。
- **新增 Rust 读文件命令返回字节**：视频播放本来就需要 asset 协议，复用它读取拖入的文件，就不用再加一条二进制 IPC 通道。
- **视频附件存进 IndexedDB**：视频体积大，会迅速撑满存储，模型也无法使用。

## Consequences

- `allow_asset_files` 由前端传入路径，信任边界与已有的 Agent 工具命令相同（前端本身可执行工具读写文件），不额外扩大可读范围。前端只对拖入文件和视频扩展名的链接调用它。
- 视频能否播放取决于 WebView 的解码能力（mov/mkv 中非 H.264/VP9 编码的会失败），失败时退回文字，不影响消息其余内容。
- 移动端（Capacitor）未改动。网页端拖入视频会按文本附件读取并被拒绝，因为网页端没有本地路径可用。

## Verification

- `npm run typecheck`、`npm run lint`（仅既有的 1 条 warning）、`npm run test:unit`（含新增 `video-links`、`attachments`、`use-file-drop`、`ChatVideo`、`MessageBubble` 用例）、`cargo test --manifest-path src-tauri/Cargo.toml`（含 `asset_files` 用例）全部通过。
- `npm run desktop:dev` 下从文件管理器拖入 png、md、mp4（路径含空格）：拖动经过时显示放置区，三者分别进入图片缩略图、文件和视频附件；发送后用户消息里的图片、文件卡片、视频播放器各自独立排在正文气泡之外，视频可以播放。
