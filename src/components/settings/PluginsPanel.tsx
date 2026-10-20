import { useState } from "react";
import type { Locale } from "../../domain/chat";
import { WHALE_UPSTREAM_URL, WHALE_WIDGET_VERSION, whaleAssetUrl } from "../../features/whale-widget/assets";
import { WhaleMark } from "../../features/whale-widget/WhaleMark";
import { openExternalUrl } from "../../services/desktop-bridge";
import { saveWhaleWidgetSettings, usePluginSettings } from "../../services/plugin-settings";

const COPY = {
  "zh-CN": {
    title: "插件",
    desc: "为工作台添加可选的小组件。插件默认关闭，数据只保存在本机。",
    whaleName: "余额小鲸鱼",
    whaleDesc: "完整移植 DeepSeek-Balance-Whale-Widget：窗口角落的鲸鱼娘显示 DeepSeek 余额、今日已用与峰谷时段，支持拖动吸附、自定义泡泡、音效、角色、余额预警、今日预算与每轮消耗提示。启用后点挂件右上角的菜单按钮（或右键挂件）进行设置。",
    assetNote: (version: string) => `挂件 v${version}，形象与音效版权归原作者，运行时从 jsDelivr 加载。`,
    toggle: "启用余额小鲸鱼",
    keyName: "需要 DeepSeek 官方 API Key",
    keyDesc: "在「模型」中配置 DeepSeek 后，小鲸鱼才能查询余额。",
    configure: "去配置",
    source: "查看原项目",
  },
  "ja-JP": {
    title: "プラグイン",
    desc: "ワークスペースに任意のウィジェットを追加します。既定はオフで、データはこの端末にのみ保存されます。",
    whaleName: "残高クジラ",
    whaleDesc: "DeepSeek-Balance-Whale-Widget の完全移植です。ウィンドウの隅のクジラ娘が DeepSeek の残高、今日の利用額、ピーク時間帯を表示し、ドラッグ吸着、吹き出しのカスタマイズ、効果音、キャラクター、残高警告、日次予算、ターンごとの消費通知に対応します。有効化後はウィジェット右上のメニューボタン（または右クリック）から設定できます。ウィジェット内の表示は中国語です。",
    assetNote: (version: string) => `ウィジェット v${version}。イラストと効果音の権利は原作者にあり、実行時に jsDelivr から読み込みます。`,
    toggle: "残高クジラを有効にする",
    keyName: "DeepSeek 公式 API Key が必要です",
    keyDesc: "「モデル」で DeepSeek を設定すると残高を取得できます。",
    configure: "設定する",
    source: "元のプロジェクト",
  },
} as const;

export interface PluginsPanelProps {
  locale: Locale;
  hasDeepSeekKey: boolean;
  onConfigureKey: () => void;
}

export function PluginsPanel({ locale, hasDeepSeekKey, onConfigureKey }: PluginsPanelProps) {
  const t = COPY[locale];
  const { whaleWidget } = usePluginSettings();
  const [thumbFailed, setThumbFailed] = useState(false);

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
              src={whaleAssetUrl("DSniang1.png")}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setThumbFailed(true)}
            />
          )}
          <div className="settings-item-card__lead">
            <strong className="settings-item-card__name">{t.whaleName}</strong>
            <span className="settings-item-card__desc">
              {t.whaleDesc}
              <span className="plugins-panel__note">
                {t.assetNote(WHALE_WIDGET_VERSION)}
                <button type="button" className="plugins-panel__link" onClick={() => void openExternalUrl(WHALE_UPSTREAM_URL)}>
                  {t.source}
                </button>
              </span>
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

        {whaleWidget.enabled && !hasDeepSeekKey ? (
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
      </div>
    </div>
  );
}
