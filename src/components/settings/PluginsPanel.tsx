import { MousePointerClick } from "lucide-react";
import { useEffect, useState } from "react";
import type { Locale } from "../../domain/chat";
import { WHALE_UPSTREAM_URL, WHALE_WIDGET_VERSION, whaleAssetUrl } from "../../features/whale-widget/assets";
import { WhaleMark } from "../../features/whale-widget/WhaleMark";
import {
  getComputerControlState,
  openExternalUrl,
  setComputerControlEnabled,
  type ComputerControlState,
} from "../../services/desktop-bridge";
import { saveWhaleWidgetSettings, usePluginSettings } from "../../services/plugin-settings";

const COPY = {
  "zh-CN": {
    title: "插件",
    desc: "为工作台添加可选的能力与小组件，数据只保存在本机。",
    computerName: "电脑控制",
    computerDesc: "允许八千代在 Agent 模式下启动与切换应用、识别窗口里的按钮和输入框、点击与键入。动作按 Agent 的权限设置审批，控制期间屏幕上显示状态条，按 Esc 随时取消。",
    computerToggle: "启用电脑控制",
    computerUnavailable: (reason: string) => `当前系统不可用：${reason}`,
    toggleFailed: "切换失败，请稍后再试",
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
    desc: "ワークスペースに任意の機能とウィジェットを追加します。データはこの端末にのみ保存されます。",
    computerName: "パソコン操作",
    computerDesc: "Agent モードで八千代がアプリの起動と切り替え、ウィンドウ内のボタンや入力欄の認識、クリックと入力を行えるようにします。各操作は Agent の権限設定に従って承認され、操作中は画面にステータスバーが表示され、Esc でいつでも取り消せます。",
    computerToggle: "パソコン操作を有効にする",
    computerUnavailable: (reason: string) => `この環境では利用できません：${reason}`,
    toggleFailed: "切り替えに失敗しました。後でもう一度お試しください",
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
  // 电脑控制只存在于桌面端，网页版查询返回 undefined 时不显示该项
  const [computer, setComputer] = useState<ComputerControlState | undefined>();
  const [computerFailed, setComputerFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getComputerControlState().then((state) => {
      if (!cancelled) setComputer(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleComputer = async () => {
    if (computer === undefined) return;
    const enabled = !computer.enabled;
    setComputer({ ...computer, enabled });
    const ok = await setComputerControlEnabled(enabled);
    setComputerFailed(!ok);
    if (!ok) setComputer(await getComputerControlState());
  };

  return (
    <div className="settings-panel-view">
      <div className="settings-panel-view__header">
        <h3 className="settings-panel-view__title">{t.title}</h3>
        <p className="settings-panel-view__desc">{t.desc}</p>
      </div>

      <div className="settings-card-group">
        {computer !== undefined ? (
          <div className="settings-item-card plugins-panel__card">
            <span className="plugins-panel__thumb plugins-panel__icon" aria-hidden="true">
              <MousePointerClick size={20} />
            </span>
            <div className="settings-item-card__lead">
              <strong className="settings-item-card__name">{t.computerName}</strong>
              <span className="settings-item-card__desc">
                {t.computerDesc}
                {!computer.supported && computer.reason ? (
                  <span className="plugins-panel__note">{t.computerUnavailable(computer.reason)}</span>
                ) : null}
                {computerFailed ? <span className="plugins-panel__note" role="alert">{t.toggleFailed}</span> : null}
              </span>
            </div>
            <div className="settings-item-card__action">
              <button
                type="button"
                role="switch"
                aria-checked={computer.enabled}
                aria-label={t.computerToggle}
                disabled={!computer.supported}
                className={`settings-toggle-switch ${computer.enabled ? "settings-toggle-switch--active" : ""}`}
                onClick={() => void toggleComputer()}
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>
          </div>
        ) : null}

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
