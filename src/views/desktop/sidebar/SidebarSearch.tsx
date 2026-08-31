import { Search, X } from "lucide-react";
import { useRef } from "react";
import type { Locale } from "../../../domain/chat";

interface SidebarSearchProps {
  locale?: Locale;
  onChange: (val: string) => void;
  value: string;
}

export function SidebarSearch({ locale = "zh-CN", onChange, value }: SidebarSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const placeholder = locale === "ja-JP" ? "会話を検索..." : "搜索历史对话...";

  const handleClear = () => {
    onChange("");
    inputRef.current?.focus();
  };

  return (
    <div className="desktop-sidebar__search">
      <Search size={14} className="desktop-sidebar__search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
          }
        }}
        placeholder={placeholder}
        className="desktop-sidebar__search-input"
        aria-label={placeholder}
      />
      {value ? (
        <button
          type="button"
          onClick={handleClear}
          className="desktop-sidebar__search-clear"
          title={locale === "ja-JP" ? "クリア" : "清空"}
          aria-label={locale === "ja-JP" ? "クリア" : "清空"}
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}
