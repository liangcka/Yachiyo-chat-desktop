import { KeyRound } from "lucide-react";
import type { Locale } from "../../domain/chat";

interface DesktopWelcomeProps {
  locale: Locale;
  /** 桌面端尚未配置任何模型：显示配置引导，替代发送后才报错 */
  needsModelSetup?: boolean;
  onSetupModel?: () => void;
}

/** 空白对话只保留首次配置引导，输入框本身就是入口。 */
export function DesktopWelcome({ locale, needsModelSetup = false, onSetupModel }: DesktopWelcomeProps) {
  if (!needsModelSetup) return null;
  const isJapanese = locale === "ja-JP";
  return (
    <section className="desktop-hero__intro" aria-label={isJapanese ? "ようこそ" : "欢迎体验"}>
      <div className="desktop-hero__setup" role="note">
        <KeyRound className="desktop-hero__setup-icon" size={18} aria-hidden="true" />
        <div className="desktop-hero__setup-text">
          <strong>{isJapanese ? "まずはモデルを接続しよう" : "先连接一个模型"}</strong>
          <span>
            {isJapanese
              ? "いずれかのプロバイダーの API キーを入力すると会話を始められます。キーはこの PC に暗号化して保存されます。"
              : "填写任一厂商的 API Key 即可开始对话，Key 只加密保存在这台电脑上。"}
          </span>
        </div>
        <button type="button" className="desktop-hero__setup-action" onClick={onSetupModel}>
          {isJapanese ? "モデルを設定" : "配置模型"}
        </button>
      </div>
    </section>
  );
}
