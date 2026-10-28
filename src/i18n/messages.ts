import type { Locale } from "../domain/chat";

export interface UiCopy {
  readonly appName: string;
  readonly menu: string;
  readonly closeMenu: string;
  readonly capture: string;
  readonly inputHint: string;
  readonly send: string;
  readonly stop: string;
  readonly settings: string;
  readonly emotionSoon: string;
  readonly speakerSoon: string;
  readonly microphoneSoon: string;
  readonly voiceSoon: string;
  readonly accessCodeLabel: string;
  readonly accessCodeHint: string;
  readonly enter: string;
  readonly verifying: string;
  readonly accessDenied: string;
  readonly accessRateLimited: string;
  readonly accessNetworkError: string;
  readonly switchLineRetry: string;
  readonly history: string;
  readonly noHistory: string;
  readonly newChat: string;
  readonly rename: string;
  readonly delete: string;
  readonly deleteConfirm: string;
  readonly signOut: string;
  readonly closeApp: string;
  readonly clearData: string;
  readonly clearDataConfirm: string;
  readonly cancel: string;
  readonly confirm: string;
  readonly localeLabel: string;
  readonly chinese: string;
  readonly japanese: string;
  readonly offline: string;
  readonly retry: string;
  readonly quotaReached: string;
  readonly genericFailure: string;
  readonly workspaceRequired: string;
  readonly sessionExpired: string;
  readonly updateReady: string;
  readonly updateAction: string;
  readonly offlineReady: string;
  readonly firstGreeting: string;
  readonly removeImage: string;
  readonly attachImage: string;
  readonly imageProcessing: string;
  readonly imageInvalid: string;
  readonly imageTooLarge: string;
  readonly storageFull: string;
  readonly exitHint: string;
  readonly truncated: string;
  readonly loopStopped: string;
  readonly runStopped: string;
  readonly runFailed: string;
  readonly runNoFinalAnswer: string;
  readonly continueRun: string;
  readonly runCancelling: string;
  readonly runWaitingForWorkspace: string;
  readonly supplementHint: string;
  readonly webCapabilityNote: string;
  readonly supplementSend: string;
  readonly runCancelled: string;
  readonly runCancelUnknown: (operations: string) => string;
  readonly continuePrompt: string;
  readonly llmSettings: string;
  readonly llmSettingsEntry: string;
  readonly llmActive: string;
  readonly llmUsingDefault: string;
  readonly llmProvider: string;
  readonly llmDomestic: string;
  readonly llmInternational: string;
  readonly llmApiKey: string;
  readonly llmModel: string;
  readonly llmApiKeyHint: (hint: string) => string;
  readonly llmNoImageSupport: string;
  readonly llmShowKey: string;
  readonly llmHideKey: string;
  readonly llmSave: string;
  readonly llmClear: string;
  readonly llmActivate: string;
  readonly llmKeyInvalid: string;
  readonly llmSaved: string;
  readonly llmCleared: string;
  readonly compressContext: string;
  readonly compressSuccess: string;
  readonly noNeedToCompress: string;
  readonly compressFailed: string;
  readonly compressingContext: string;
  readonly memoryLabel: string;
  readonly loadEarlierLabel: string;
  readonly userMemoryEntry: string;
  readonly userMemoryTitle: string;
  readonly userMemoryDescription: string;
  readonly userMemoryPlaceholder: string;
  readonly userMemorySave: string;
  readonly userMemoryClear: string;
  readonly userMemorySaved: string;
  readonly userMemoryCleared: string;
  readonly userMemorySaveFailed: string;
  readonly recall: string;
  readonly recallSuccess: string;
  readonly copyText: string;
  readonly copied: string;
  readonly expandMessage: string;
  readonly regenerate: string;
  readonly thinking: string;
  readonly deepThinking: string;
  readonly thoughtProcess: string;
  readonly thoughtCompleted: string;
  readonly skillsEntry: string;
  readonly skillsTitle: string;
  readonly skillsDescription: string;
  readonly skillEnable: string;
  readonly skillDisable: string;
  readonly skillToggleLabel: string;
  readonly skillViewContent: string;
  readonly skillHideContent: string;
  readonly webSearchTitle: string;
  readonly webSearchDescription: string;
  readonly webSearchShowSources: string;
  readonly webSearchShowSourcesDescription: string;
  readonly webSearchSmart: string;
  readonly webSearchSmartDescription: string;
  readonly sourcesLabel: string;
  readonly workspaceEntry: string;
  readonly workspaceTitle: string;
  readonly workspaceDescription: string;
  /* 阶段二编辑器三件套（B1 编辑器 / B2 变更审阅 / B3 文件树与 @ 引用） */
  readonly editorViewTab: string;
  readonly editorTab: string;
  readonly editorTabEmpty: string;
  readonly editorSaving: string;
  readonly editorModified: string;
  readonly editorSaved: string;
  readonly editorReadOnly: string;
  readonly editorSaveHint: string;
  readonly editorCloseTab: string;
  readonly reviewTitle: string;
  readonly reviewGitTitle: string;
  readonly reviewEmpty: string;
  readonly reviewEmptyTitle: string;
  readonly reviewEmptyDesc: string;
  readonly selectProject: string;
  readonly changeProject: string;
  readonly noProjectSelected: string;
  readonly fileTreeTitle: string;
  readonly checkpointsTitle: string;
  readonly terminalTitle: string;
  readonly reviewCards: string;
  readonly reviewCompare: string;
  readonly reviewAddedNote: string;
  readonly reviewDeletedNote: string;
  readonly reviewNoSelection: string;
  readonly reviewDiffEmpty: string;
  readonly reviewFilesLabel: string;
  readonly reviewEntryButton: string;
  readonly reviewTaskTab: string;
  readonly reviewGitTab: string;
  readonly reviewGitReadOnlyNote: string;
  readonly reviewNoRun: string;
  readonly refreshFileTree: string;
  readonly treeLoading: string;
  readonly treeEmpty: string;
  readonly treeLoadingDir: string;
  readonly referenceToChat: string;
  readonly referenceFileLabel: (name: string) => string;
  readonly themeLabel: string;
  readonly themeLight: string;
  readonly themeDark: string;
  readonly themeSystem: string;
  readonly desktopKeyRequired: string;
  readonly apiKeyMissing: string;
  readonly whaleKeyMissing: string;
  readonly whaleKeyRejected: string;
  readonly desktopUpdateAvailable: (version: string) => string;
  readonly desktopUpdateAction: string;
  readonly desktopUpdateDownloading: (percent: number | undefined) => string;
  readonly desktopUpdateInstalling: string;
  readonly desktopUpdateFailed: string;
  readonly desktopUpdateOpenRelease: string;
  readonly serverCredentialsCleared: string;
}

const chinese = Object.freeze({
  appName: "Yachiyo Chat",
  menu: "菜单",
  closeMenu: "关闭菜单",
  capture: "拍摄",
  inputHint: "想问什么都可以，@ 引用文件，/ 执行动作",
  send: "发送",
  stop: "停止",
  settings: "设置",
  emotionSoon: "情绪功能即将开放",
  speakerSoon: "扬声器功能即将开放",
  microphoneSoon: "麦克风功能即将开放",
  voiceSoon: "语音功能即将开放",
  accessCodeLabel: "访问码",
  accessCodeHint: "输入共享访问码",
  enter: "进入",
  verifying: "正在验证…",
  accessDenied: "访问码不正确，请重试。",
  accessRateLimited: "尝试次数过多，请稍后再试。",
  accessNetworkError: "连不上服务器，请检查网络后重试。",
  switchLineRetry: "切换线路重试",
  history: "历史记录",
  noHistory: "还没有历史对话",
  newChat: "新建对话",
  rename: "重命名",
  delete: "删除",
  deleteConfirm: "确定删除这段对话吗？",
  signOut: "退出访问",
  closeApp: "关闭应用",
  clearData: "清除本地数据",
  clearDataConfirm: "这会删除当前设备上的全部聊天记录，确定继续吗？",
  cancel: "取消",
  confirm: "确定",
  localeLabel: "语言",
  chinese: "简体中文",
  japanese: "日本語",
  offline: "当前离线，可查看本地记录",
  retry: "重试",
  quotaReached: "今天的对话次数已用完，请明天再来。",
  genericFailure: "暂时连接不上，再试一次吧。",
  workspaceRequired: "此任务需要先选择或打开一个项目工作区。",
  sessionExpired: "访问已过期，请重新输入访问码。",
  updateReady: "新版本已经准备好了。",
  updateAction: "立即更新",
  offlineReady: "应用已可离线打开。",
  firstGreeting: "彩叶~今天也辛苦啦！（笑着朝你挥了挥手）",
  removeImage: "移除图片",
  attachImage: "添加图片",
  imageProcessing: "正在处理图片…",
  imageInvalid: "请选择 JPEG、PNG 或 WebP 图片。",
  imageTooLarge: "图片太大，请换一张试试。",
  storageFull: "本地空间不足，请先清理历史记录。",
  exitHint: "再按一次返回键退出",
  truncated: "回复太长，已截断显示。",
  loopStopped: "检测到重复循环，已自动停止。",
  runStopped: "已中断，回复没有完成。",
  runFailed: "运行出错，回复没有完成。",
  runNoFinalAnswer: "执行完工具后没有给出最终答复。",
  continueRun: "继续",
  runCancelling: "正在取消：等待运行中的操作结束…",
  runWaitingForWorkspace: "等待同一项目中的其他任务完成写入后继续…",
  supplementHint: "补充要求会在 Agent 下一步之前送达，不会中断当前任务",
  webCapabilityNote: "网页版只提供对话、附件与联网搜索。读写项目文件、运行命令、审阅与撤销改动需要在桌面版中进行。",
  supplementSend: "追加补充要求（不中断任务）",
  runCancelled: "已取消，运行中的命令已确认结束。",
  runCancelUnknown: (operations) => `已取消，但这些操作的结果无法确认：${operations}。继续前请先核对实际状态。`,
  continuePrompt: "继续",
  llmSettings: "LLM 设置",
  llmSettingsEntry: "LLM 设置",
  llmActive: "当前使用",
  llmUsingDefault: "未配置，使用默认服务",
  llmProvider: "厂商",
  llmDomestic: "国内",
  llmInternational: "国际",
  llmApiKey: "API Key",
  llmModel: "模型",
  llmApiKeyHint: (hint) => hint,
  llmNoImageSupport: "该厂商暂不支持图片输入",
  llmShowKey: "显示",
  llmHideKey: "隐藏",
  llmSave: "保存",
  llmClear: "清除配置",
  llmActivate: "设为当前",
  llmKeyInvalid: "API Key 格式不正确，请检查后重试。",
  llmSaved: "配置已保存",
  llmCleared: "配置已清除",
  compressContext: "压缩上下文",
  compressSuccess: "上下文已成功压缩并保存至记忆",
  noNeedToCompress: "当前对话较短，暂无需压缩",
  compressFailed: "压缩上下文失败，请稍后重试",
  compressingContext: "正在压缩上下文…",
  memoryLabel: "对话记忆",
  loadEarlierLabel: "加载更早的消息",
  userMemoryEntry: "长期记忆",
  userMemoryTitle: "长期记忆管理",
  userMemoryDescription:
    "八千代跨对话记住的关于你的信息（压缩上下文时自动提炼，也可手动编辑）；新对话中同样生效。",
  userMemoryPlaceholder: "暂无长期记忆。与八千代对话并压缩上下文后会自动生成，也可在此手动填写。",
  userMemorySave: "保存记忆",
  userMemoryClear: "清除记忆",
  userMemorySaved: "长期记忆已保存",
  userMemoryCleared: "长期记忆已清除",
  userMemorySaveFailed: "长期记忆保存失败，请重试",
  recall: "撤回",
  recallSuccess: "已撤回最新一条消息",
  copyText: "复制",
  copied: "已复制",
  expandMessage: "展开",
  regenerate: "重新生成",
  thinking: "思考中…",
  deepThinking: "深度思考中…",
  thoughtProcess: "思考过程",
  thoughtCompleted: "已深度思考",
  skillsEntry: "技能",
  skillsTitle: "技能",
  skillsDescription: "供对话调用的文本处理技能，启用后自动生效",
  skillEnable: "启用",
  skillDisable: "停用",
  skillToggleLabel: "切换技能启用状态",
  skillViewContent: "查看技能说明",
  skillHideContent: "收起技能说明",
  webSearchTitle: "联网搜索",
  webSearchDescription: "发送前先用必应搜索网络资料，回复将基于最新信息",
  webSearchShowSources: "显示引用来源",
  webSearchShowSourcesDescription: "在联网回复下方显示参考来源链接",
  webSearchSmart: "智能搜索",
  webSearchSmartDescription: "同时检索国际市场近30天结果，提升时效信息的准确性",
  sourcesLabel: "参考来源",
  workspaceEntry: "工作区 & Agent",
  workspaceTitle: "工作区 & Agent 终端",
  workspaceDescription: "配置本地 Agent 工具的运行目录，支持安全文件读写与终端命令执行。",
  editorViewTab: "对话",
  editorTab: "编辑器",
  editorTabEmpty: "从右侧文件树选择文件打开",
  editorSaving: "保存中…",
  editorModified: "● 已修改",
  editorSaved: "已保存",
  editorReadOnly: "只读（大文件）",
  editorSaveHint: "Ctrl+S 保存（核对版本，覆盖前备份）",
  editorCloseTab: "关闭标签页",
  reviewTitle: "变更审阅",
  reviewGitTitle: "工作区差异（相对 HEAD）",
  reviewEmpty: "没有未提交的改动",
  reviewEmptyTitle: "没有未提交的改动",
  reviewEmptyDesc: "这里只读显示相对 Git HEAD 的全部未提交改动",
  selectProject: "选择项目",
  changeProject: "更换",
  noProjectSelected: "未选择项目",
  fileTreeTitle: "文件树",
  checkpointsTitle: "检查点",
  terminalTitle: "终端",
  reviewCards: "卡片",
  reviewCompare: "对比",
  reviewAddedNote: "未跟踪的新文件",
  reviewDeletedNote: "已删除",
  reviewNoSelection: "选择左侧变更文件查看差异",
  reviewDiffEmpty: "与 HEAD 无内容差异",
  reviewFilesLabel: "变更文件",
  reviewEntryButton: "审阅",
  reviewTaskTab: "本次任务",
  reviewGitTab: "工作区 Git",
  reviewGitReadOnlyNote: "只读：包含任务开始前就有的改动。要撤销 Agent 的改动，请在“本次任务”中操作。",
  reviewNoRun: "当前会话还没有改动过文件的任务",
  refreshFileTree: "刷新文件树",
  treeLoading: "加载工作区…",
  treeEmpty: "（空目录或未连接桌面运行时）",
  treeLoadingDir: "加载中…",
  referenceToChat: "引用到对话",
  referenceFileLabel: (name) => `引用 ${name} 到对话`,
  themeLabel: "外观",
  themeLight: "浅色",
  themeDark: "深色",
  themeSystem: "跟随系统",
  desktopKeyRequired: "还没有可用的模型，请在「设置 → 模型」中填写 API Key 并启用。",
  apiKeyMissing: "找不到当前模型已保存的 API Key，请在「设置 → 模型」中编辑该模型并重新填写 Key。",
  whaleKeyMissing: "余额小鲸鱼读不到已保存的 DeepSeek API Key，请在「设置 → 模型」中重新填写。",
  whaleKeyRejected: "余额小鲸鱼：DeepSeek 拒绝了当前 API Key，请在「设置 → 模型」中更新。",
  desktopUpdateAvailable: (version) => `发现新版本 v${version}`,
  desktopUpdateAction: "立即更新",
  desktopUpdateDownloading: (percent) => (percent === undefined ? "正在下载更新…" : `正在下载更新 ${percent}%`),
  desktopUpdateInstalling: "正在安装，完成后自动重启…",
  desktopUpdateFailed: "更新失败，可前往下载页手动安装",
  desktopUpdateOpenRelease: "前往下载",
  serverCredentialsCleared: "服务端凭据已清除",
} satisfies UiCopy);

const japanese = Object.freeze({
  appName: "Yachiyo Chat",
  menu: "メニュー",
  closeMenu: "メニューを閉じる",
  capture: "撮影",
  inputHint: "何でも聞いてね。@ でファイル参照、/ でアクション",
  send: "送信",
  stop: "停止",
  settings: "設定",
  emotionSoon: "感情機能は近日公開です",
  speakerSoon: "スピーカー機能は近日公開です",
  microphoneSoon: "マイク機能は近日公開です",
  voiceSoon: "音声機能は近日公開です",
  accessCodeLabel: "アクセスコード",
  accessCodeHint: "共有アクセスコードを入力",
  enter: "入る",
  verifying: "確認中…",
  accessDenied: "アクセスコードが違います。もう一度お試しください。",
  accessRateLimited: "試行回数が多すぎます。しばらくしてからお試しください。",
  accessNetworkError: "サーバーに接続できません。ネットワークを確認して再試行してください。",
  switchLineRetry: "回線を切り替えて再試行",
  history: "履歴",
  noHistory: "まだ会話履歴はありません",
  newChat: "新しい会話",
  rename: "名前を変更",
  delete: "削除",
  deleteConfirm: "この会話を削除しますか？",
  signOut: "アクセスを終了",
  closeApp: "アプリを終了",
  clearData: "端末データを消去",
  clearDataConfirm: "この端末の会話履歴をすべて削除します。続けますか？",
  cancel: "キャンセル",
  confirm: "確認",
  localeLabel: "言語",
  chinese: "简体中文",
  japanese: "日本語",
  offline: "オフラインです。端末の履歴は閲覧できます",
  retry: "もう一度",
  quotaReached: "本日の会話回数を使い切りました。また明日ね。",
  genericFailure: "今はつながらないみたい。もう一度試してね。",
  workspaceRequired: "この操作にはプロジェクトワークスペースが必要です。",
  sessionExpired: "アクセス期限が切れました。コードを再入力してください。",
  updateReady: "新しいバージョンを利用できます。",
  updateAction: "今すぐ更新",
  offlineReady: "オフラインでも開けるようになりました。",
  firstGreeting: "彩葉~今日もお疲れさま！（笑顔で手を振る）",
  removeImage: "画像を外す",
  attachImage: "画像を添付",
  imageProcessing: "画像を処理中…",
  imageInvalid: "JPEG、PNG、WebP の画像を選んでください。",
  imageTooLarge: "画像が大きすぎます。別の画像を試してください。",
  storageFull: "端末の空き容量が足りません。履歴を整理してください。",
  exitHint: "もう一度戻ると終了します",
  truncated: "返答が長すぎたため、途中まで表示しています。",
  loopStopped: "同じ処理の繰り返しを検知したため、自動で停止しました。",
  runStopped: "途中で中断されたため、返答は完了していません。",
  runFailed: "エラーのため、返答を完了できませんでした。",
  runNoFinalAnswer: "ツール実行後、最終的な返答がありませんでした。",
  continueRun: "続ける",
  runCancelling: "キャンセル中：実行中の操作の終了を待っています…",
  runWaitingForWorkspace: "同じプロジェクトの別タスクの書き込みが終わるのを待っています…",
  supplementHint: "追加の指示は Agent の次のステップの前に届きます。タスクは中断されません",
  webCapabilityNote: "Web 版では会話・添付・ウェブ検索のみ利用できます。プロジェクトファイルの読み書き、コマンドの実行、変更のレビューと取り消しはデスクトップ版で行ってください。",
  supplementSend: "追加の指示を送る（タスクは中断しません）",
  runCancelled: "キャンセルしました。実行中のコマンドの終了を確認済みです。",
  runCancelUnknown: (operations) => `キャンセルしましたが、次の操作の結果を確認できません：${operations}。続ける前に実際の状態を確認してください。`,
  continuePrompt: "続けて",
  llmSettings: "LLM 設定",
  llmSettingsEntry: "LLM 設定",
  llmActive: "現在使用中",
  llmUsingDefault: "未設定、デフォルトを使用",
  llmProvider: "プロバイダ",
  llmDomestic: "国内",
  llmInternational: "国際",
  llmApiKey: "API Key",
  llmModel: "モデル",
  llmApiKeyHint: (hint) => hint,
  llmNoImageSupport: "このプロバイダは画像入力に対応していません",
  llmShowKey: "表示",
  llmHideKey: "非表示",
  llmSave: "保存",
  llmClear: "設定を削除",
  llmActivate: "現在の設定にする",
  llmKeyInvalid: "API Key の形式が正しくありません。確認してください。",
  llmSaved: "設定を保存しました",
  llmCleared: "設定を削除しました",
  compressContext: "コンテキストを圧縮",
  compressSuccess: "コンテキストを圧縮して記憶に保存しました",
  noNeedToCompress: "会話が短いため、まだ圧縮の必要はありません",
  compressFailed: "コンテキストの圧縮に失敗しました。後でもう一度お試しください",
  compressingContext: "コンテキストを圧縮中…",
  memoryLabel: "会話の記憶",
  loadEarlierLabel: "前のメッセージを読み込む",
  userMemoryEntry: "長期記憶",
  userMemoryTitle: "長期記憶の管理",
  userMemoryDescription:
    "八千代が会話をまたいで覚えているあなたの情報（コンテキスト圧縮時に自動で抽出、手動編集も可能）。新しい会話でも有効です。",
  userMemoryPlaceholder:
    "長期記憶はまだありません。八千代との会話を圧縮すると自動で生成されます。ここに手動で入力することもできます。",
  userMemorySave: "記憶を保存",
  userMemoryClear: "記憶を削除",
  userMemorySaved: "長期記憶を保存しました",
  userMemoryCleared: "長期記憶を削除しました",
  userMemorySaveFailed: "長期記憶の保存に失敗しました。もう一度お試しください",
  recall: "取り消す",
  recallSuccess: "最新のメッセージを取り消しました",
  copyText: "コピー",
  copied: "コピーしました",
  expandMessage: "展開",
  regenerate: "再生成",
  thinking: "考え中…",
  deepThinking: "深く思考中…",
  thoughtProcess: "思考プロセス",
  thoughtCompleted: "思考完了",
  skillsEntry: "スキル",
  skillsTitle: "スキル",
  skillsDescription: "会話で使用するテキスト処理スキル。有効にすると自動的に適用されます",
  skillEnable: "有効にする",
  skillDisable: "無効にする",
  skillToggleLabel: "スキルの有効/無効を切り替える",
  skillViewContent: "スキルの説明を見る",
  skillHideContent: "スキルの説明を閉じる",
  webSearchTitle: "ウェブ検索",
  webSearchDescription: "送信前にBingでウェブ検索し、最新情報をもとに返信します",
  webSearchShowSources: "引用ソースを表示",
  webSearchShowSourcesDescription: "ウェブ検索の返信の下に参考ソースへのリンクを表示します",
  webSearchSmart: "スマート検索",
  webSearchSmartDescription: "国際市場の直近30日間の結果も同時に検索し、最新情報の正確性を高めます",
  sourcesLabel: "参考ソース",
  workspaceEntry: "ワークスペース & Agent",
  workspaceTitle: "ワークスペース & Agent ターミナル",
  workspaceDescription: "ローカルAgentツールの実行ディレクトリを設定し、安全なファイル読み書きとターミナルコマンド実行をサポートします。",
  editorViewTab: "チャット",
  editorTab: "エディター",
  editorTabEmpty: "右側のファイルツリーからファイルを開いてください",
  editorSaving: "保存中…",
  editorModified: "● 変更あり",
  editorSaved: "保存済み",
  editorReadOnly: "読み取り専用（大容量ファイル）",
  editorSaveHint: "Ctrl+S で保存（バージョン確認・上書き前にバックアップ）",
  editorCloseTab: "タブを閉じる",
  reviewTitle: "変更レビュー",
  reviewGitTitle: "ワークスペースの差分（HEAD 比較）",
  reviewEmpty: "未コミットの変更はありません",
  reviewEmptyTitle: "未コミットの変更はありません",
  reviewEmptyDesc: "Git HEAD と比べた未コミットの変更をすべて閲覧専用で表示します",
  selectProject: "プロジェクトを選択",
  changeProject: "変更",
  noProjectSelected: "プロジェクト未選択",
  fileTreeTitle: "ファイルツリー",
  checkpointsTitle: "チェックポイント",
  terminalTitle: "ターミナル",
  reviewCards: "カード",
  reviewCompare: "比較",
  reviewAddedNote: "未追跡の新規ファイル",
  reviewDeletedNote: "削除済み",
  reviewNoSelection: "左側の変更ファイルを選択して差分を確認",
  reviewDiffEmpty: "HEAD との差分はありません",
  reviewFilesLabel: "変更ファイル",
  reviewEntryButton: "レビュー",
  reviewTaskTab: "今回のタスク",
  reviewGitTab: "ワークスペース Git",
  reviewGitReadOnlyNote: "閲覧専用：タスク開始前からある変更も含みます。Agent の変更を取り消すには「今回のタスク」で操作してください。",
  reviewNoRun: "このチャットにはファイルを変更したタスクがまだありません",
  refreshFileTree: "ファイルツリーを更新",
  treeLoading: "ワークスペースを読み込み中…",
  treeEmpty: "（空のディレクトリまたはデスクトップランタイム未接続）",
  treeLoadingDir: "読み込み中…",
  referenceToChat: "チャットに引用",
  referenceFileLabel: (name) => `${name} をチャットに引用`,
  themeLabel: "外観",
  themeLight: "ライト",
  themeDark: "ダーク",
  themeSystem: "システム設定",
  desktopKeyRequired: "利用できるモデルがありません。「設定 → モデル」で API キーを入力して有効にしてください。",
  apiKeyMissing: "このモデルの保存済み API キーが見つかりません。「設定 → モデル」でモデルを編集し、キーを入力し直してください。",
  whaleKeyMissing: "残高クジラが保存済みの DeepSeek API キーを読み取れません。「設定 → モデル」で入力し直してください。",
  whaleKeyRejected: "残高クジラ：DeepSeek が現在の API キーを拒否しました。「設定 → モデル」で更新してください。",
  desktopUpdateAvailable: (version) => `新しいバージョン v${version} があります`,
  desktopUpdateAction: "今すぐ更新",
  desktopUpdateDownloading: (percent) => (percent === undefined ? "更新をダウンロード中…" : `更新をダウンロード中 ${percent}%`),
  desktopUpdateInstalling: "インストール中です。完了後に自動で再起動します…",
  desktopUpdateFailed: "更新に失敗しました。ダウンロードページから手動でインストールできます",
  desktopUpdateOpenRelease: "ダウンロード",
  serverCredentialsCleared: "サーバー側の認証情報を削除しました",
} satisfies UiCopy);

const dictionaries: Readonly<Record<Locale, UiCopy>> = Object.freeze({
  "zh-CN": chinese,
  "ja-JP": japanese,
});

export function copyFor(locale: Locale): UiCopy {
  return dictionaries[locale];
}
