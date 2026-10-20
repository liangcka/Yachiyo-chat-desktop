import { useState } from "react";
import type { Locale } from "../../domain/chat";
import {
  checkWhaleAssetUpdate,
  WHALE_UPSTREAM_URL,
  whaleImageUrl,
} from "../../features/whale-widget/assets";
import { WhaleMark } from "../../features/whale-widget/WhaleMark";
import { openExternalUrl } from "../../services/desktop-bridge";
import { saveWhaleWidgetSettings, usePluginSettings } from "../../services/plugin-settings";

const COPY = {
  "zh-CN": {
    title: "插件",
    desc: "为工作台添加可选的小组件。插件默认关闭，数据只保存在本机。",
    whaleName: "余额小鲸鱼",
    whaleDesc: "在窗口角落显示 DeepSeek 余额、今日已用和峰谷时段，可拖动并吸附到左右两侧。改编自 DeepSeek-Balance-Whale-Widget。",
    toggle: "启用余额小鲸鱼",
    turnCostName: "每轮消耗提示",
    turnCostDesc: "DeepSeek 回复结束后，按余额变化冒泡提示这一轮花了多少。",
    turnCostToggle: "切换每轮消耗提示",
    assetName: "鲸鱼娘素材",
    assetDesc: (version: string) => `当前 v${version}，素材版权归原作者，运行时从 jsDelivr 加载，离线时显示内置鲸鱼。`,
    check: "检查更新",
    checking: "检查中…",
    upToDate: "已是最新",
    update: (version: string) => `更新到 v${version}`,
    updated: (version: string) => `已更新到 v${version}`,
    checkFailed: "检查失败，请稍后再试",
    keyName: "需要 DeepSeek 官方 API Key",
    keyDesc: "在「模型」中配置 DeepSeek 后，小鲸鱼才能查询余额。",
    configure: "去配置",
    source: "查看原项目",
  },
  "ja-JP": {
    title: "プラグイン",
    desc: "ワークスペースに任意のウィジェットを追加します。既定はオフで、データはこの端末にのみ保存されます。",
    whaleName: "残高クジラ",
    whaleDesc: "ウィンドウの隅に DeepSeek の残高、今日の利用額、ピーク時間帯を表示します。ドラッグで左右に吸着できます。DeepSeek-Balance-Whale-Widget を元にしています。",
    toggle: "残高クジラを有効にする",
    turnCostName: "ターンごとの消費通知",
    turnCostDesc: "DeepSeek の返信が終わるたびに、残高の変化から今回の消費額を吹き出しで知らせます。",
    turnCostToggle: "ターンごとの消費通知を切り替え",
    assetName: "クジラ娘の素材",
    assetDesc: (version: string) => `現在 v${version}。素材の権利は原作者にあり、実行時に jsDelivr から読み込みます。オフライン時は内蔵のクジラを表示します。`,
    check: "更新を確認",
    checking: "確認中…",
    upToDate: "最新です",
    update: (version: string) => `v${version} に更新`,
    updated: (version: string) => `v${version} に更新しました`,
    checkFailed: "確認に失敗しました。後でもう一度お試しください",
    keyName: "DeepSeek 公式 API Key が必要です",
    keyDesc: "「モデル」で DeepSeek を設定すると残高を取得できます。",
    configure: "設定する",
    source: "元のプロジェクト",
  },
} as const;

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "available"; version: string }
  | { kind: "updated"; version: string }
  | { kind: "failed" };

export interface PluginsPanelProps {
  locale: Locale;
  hasDeepSeekKey: boolean;
  onConfigureKey: () => void;
}

export function PluginsPanel({ locale, hasDeepSeekKey, onConfigureKey }: PluginsPanelProps) {
  const t = COPY[locale];
  const { whaleWidget } = usePluginSettings();
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });
  const [thumbFailed, setThumbFailed] = useState(false);

  const handleCheck = async () => {
    setCheck({ kind: "checking" });
    try {
      const result = await checkWhaleAssetUpdate(whaleWidget.assetVersion);
      setCheck(result.available ? { kind: "available", version: result.latest } : { kind: "latest" });
    } catch {
      setCheck({ kind: "failed" });
    }
  };

  const handleUpdate = (version: string) => {
    saveWhaleWidgetSettings({ assetVersion: version });
    setCheck({ kind: "updated", version });
  };

  const checkLabel = check.kind === "checking" ? t.checking
    : check.kind === "latest" ? t.upToDate
      : check.kind === "updated" ? t.updated(check.version)
        : check.kind === "failed" ? t.checkFailed
          : null;

  return (
    <div className="settings-panel-view">
      <div className="settings-panel-view__header">
        <h3 className="settings-panel-view__title">{t.title}</h3>
        <p className="settings-panel-view__desc">{t.desc}</p>
      </div>

      <div className="settings-card-group">
        <div className="settings-item-card plugins-panel__card">
          {thumbFailed ? (
            <WhaleMark size={40} className="plugins-panel__thumb" />
          ) : (
            <img
              className="plugins-panel__thumb"
              src={whaleImageUrl(whaleWidget.assetVersion)}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setThumbFailed(true)}
            />
          )}
          <div className="settings-item-card__lead">
            <strong className="settings-item-card__name">{t.whaleName}</strong>
            <span className="settings-item-card__desc">
              {t.whaleDesc}
              <button type="button" className="plugins-panel__link" onClick={() => void openExternalUrl(WHALE_UPSTREAM_URL)}>
                {t.source}
              </button>
            </span>
          </div>
          <div className="settings-item-card__action">
            <button
              type="button"
              role="switch"
              aria-checked={whaleWidget.enabled}
              aria-label={t.toggle}
              className={`settings-toggle-switch ${whaleWidget.enabled ? "settings-toggle-switch--active" : ""}`}
              onClick={() => saveWhaleWidgetSettings({ enabled: !whaleWidget.enabled })}
            >
              <span className="settings-toggle-knob" />
            </button>
          </div>
        </div>

        {whaleWidget.enabled ? (
          <>
            {!hasDeepSeekKey ? (
              <div className="settings-item-card">
                <div className="settings-item-card__lead">
                  <strong className="settings-item-card__name">{t.keyName}</strong>
                  <span className="settings-item-card__desc">{t.keyDesc}</span>
                </div>
                <div className="settings-item-card__action">
                  <button type="button" className="settings-btn" onClick={onConfigureKey}>{t.configure}</button>
                </div>
              </div>
            ) : null}

            <div className="settings-item-card">
              <div className="settings-item-card__lead">
                <strong className="settings-item-card__name">{t.turnCostName}</strong>
                <span className="settings-item-card__desc">{t.turnCostDesc}</span>
              </div>
              <div className="settings-item-card__action">
                <button
                  type="button"
                  role="switch"
                  aria-checked={whaleWidget.turnCostBubble}
                  aria-label={t.turnCostToggle}
                  className={`settings-toggle-switch ${whaleWidget.turnCostBubble ? "settings-toggle-switch--active" : ""}`}
                  onClick={() => saveWhaleWidgetSettings({ turnCostBubble: !whaleWidget.turnCostBubble })}
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>
            </div>

            <div className="settings-item-card">
              <div className="settings-item-card__lead">
                <strong className="settings-item-card__name">{t.assetName}</strong>
                <span className="settings-item-card__desc">
                  {t.assetDesc(whaleWidget.assetVersion)}
                  {checkLabel !== null ? <span className="plugins-panel__check" role="status">{checkLabel}</span> : null}
                </span>
              </div>
              <div className="settings-item-card__action">
                {check.kind === "available" ? (
                  <button type="button" className="settings-btn" onClick={() => handleUpdate(check.version)}>
                    {t.update(check.version)}
                  </button>
                ) : (
                  <button type="button" className="settings-btn" disabled={check.kind === "checking"} onClick={() => void handleCheck()}>
                    {t.check}
                  </button>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
