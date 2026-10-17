import { Camera, Globe, MessageCircle, Terminal } from "lucide-react";
import type { Locale } from "../../domain/chat";
import { useLocalUserSettings } from "../../services/user-settings";

interface DesktopWelcomeProps {
  disabled: boolean;
  locale: Locale;
  onPrompt: (prompt: string) => void;
}

export function DesktopWelcome({ disabled, locale, onPrompt }: DesktopWelcomeProps) {
  const [{ username }] = useLocalUserSettings();
  const hour = new Date().getHours();
  const greeting = locale === "ja-JP"
    ? (hour < 11 ? "おはよう" : hour < 18 ? "こんにちは" : "こんばんは")
    : (hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好");
  const isJapanese = locale === "ja-JP";
  const suggestions = [
    {
      icon: Terminal,
      title: isJapanese ? "コードを読み解く" : "看看工作区",
      prompt: isJapanese
        ? "八千代、今のワークスペースのファイルとフォルダーを確認して、プロジェクトを簡単に紹介して。"
        : "八千代，请帮我查看当前工作区根目录下有哪些文件和文件夹，向我简要介绍一下。",
    },
    {
      icon: MessageCircle,
      title: isJapanese ? "ちょっとおしゃべり" : "聊聊今天",
      prompt: isJapanese
        ? "八千代、今日は何か面白いことあった？ 一緒におしゃべりしよう。"
        : "八千代，今天有什么有趣的事情发生吗？陪我聊聊天吧~",
    },
    {
      icon: Globe,
      title: isJapanese ? "気になることを調べる" : "探索新知",
      prompt: isJapanese
        ? "八千代、DeepSeek のオープンソース開発や技術の最新情報を調べて。"
        : "八千代，请帮我搜索关于 DeepSeek 最新开源进展和技术动态。",
    },
    {
      icon: Camera,
      title: isJapanese ? "画像を一緒に見る" : "读懂图片",
      prompt: isJapanese
        ? "八千代、画像認識や画像分析でどんなことができるか教えて。"
        : "八千代，请向我介绍一下你支持哪些视觉与图片分析功能？",
    },
  ];

  return (
    <>
      <section className="desktop-hero__intro" aria-label={isJapanese ? "ようこそ" : "欢迎体验"}>
        <h1 className="desktop-hero__title">{greeting}{isJapanese ? "、" : "，"}{username}</h1>
      </section>
      <div className="desktop-hero__cards" aria-label={isJapanese ? "会話のきっかけ" : "试试这些话题"}>
        {suggestions.map(({ icon: Icon, title, prompt }) => (
          <button
            key={title}
            type="button"
            className="desktop-hero-card"
            disabled={disabled}
            onClick={() => onPrompt(prompt)}
          >
            <Icon className="desktop-hero-card__icon" size={18} aria-hidden="true" />
            <span className="desktop-hero-card__title">{title}</span>
          </button>
        ))}
      </div>
    </>
  );
}
