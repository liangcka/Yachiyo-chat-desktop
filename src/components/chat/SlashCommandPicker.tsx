import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Globe, Minimize2, Plus, Sparkles, Terminal, X } from "lucide-react";
import type { SkillDefinition } from "../../skills";

export interface SlashActionItem {
  id: string;
  type: "action";
  name: string;
  command: string;
  description: string;
  icon?: "bot" | "globe" | "terminal" | "compress" | "plus";
  badge?: string;
  onExecute: () => void;
}

export interface SlashSkillItem {
  id: string;
  type: "skill";
  name: string;
  command: string;
  description: string;
  isActive: boolean;
  skill: SkillDefinition;
  onToggle: (next: boolean) => void;
}

export type SlashItem = SlashActionItem | SlashSkillItem;

export interface SlashCommandPickerProps {
  /** 当前 / 之后的检索关键词 */
  query: string;
  /** 所有支持的技能列表 */
  skills: readonly SkillDefinition[];
  /** 当前已激活的技能 ID 列表 */
  activeSkillIds: readonly string[];
  /** 快捷动作列表 */
  actions?: readonly SlashActionItem[];
  /** 选中执行回调 */
  onSelect: (item: SlashItem) => void;
  /** 切换技能回调 */
  onToggleSkill: (skillId: string, next: boolean) => void;
  /** 关闭浮层回调 */
  onClose: () => void;
  /** 键盘选中的索引（可选受控） */
  selectedIndex?: number;
  /** 索引变更回调 */
  onSelectedIndexChange?: (index: number) => void;
}

/** 高亮匹配 query 的文本片段 */
function HighlightMatchedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) {
    return <span>{text}</span>;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIdx = lowerText.indexOf(lowerQuery);

  if (matchIdx === -1) {
    return <span>{text}</span>;
  }

  const before = text.slice(0, matchIdx);
  const match = text.slice(matchIdx, matchIdx + query.length);
  const after = text.slice(matchIdx + query.length);

  return (
    <span>
      {before}
      <span className="slash-cmd-picker__highlight">{match}</span>
      {after}
    </span>
  );
}

export function SlashCommandPicker({
  query,
  skills,
  activeSkillIds,
  actions = [],
  onSelect,
  onToggleSkill,
  onClose,
  selectedIndex: controlledIndex,
  onSelectedIndexChange,
}: SlashCommandPickerProps) {
  const [uncontrolledIndex, setUncontrolledIndex] = useState(0);
  const isControlled = controlledIndex !== undefined;
  const activeIndex = isControlled ? controlledIndex : uncontrolledIndex;

  const setActiveIndex = (idx: number) => {
    if (!isControlled) {
      setUncontrolledIndex(idx);
    }
    onSelectedIndexChange?.(idx);
  };

  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setUncontrolledIndex(0);
  }

  // 构建全部条目
  const allItems = useMemo<SlashItem[]>(() => {
    const skillItems: SlashSkillItem[] = skills.map((skill) => ({
      id: `skill:${skill.id}`,
      type: "skill",
      name: skill.name,
      command: `/${skill.id}`,
      description: skill.description,
      isActive: activeSkillIds.includes(skill.id),
      skill,
      onToggle: (next: boolean) => onToggleSkill(skill.id, next),
    }));

    return [...actions, ...skillItems];
  }, [actions, activeSkillIds, onToggleSkill, skills]);

  // 根据 query 模糊检索条目
  const filteredList = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;

    return allItems.filter((item) => {
      const matchName = item.name.toLowerCase().includes(q);
      const matchCmd = item.command.toLowerCase().includes(q);
      const matchDesc = item.description.toLowerCase().includes(q);
      return matchName || matchCmd || matchDesc;
    });
  }, [allItems, query]);

  const listRef = useRef<HTMLUListElement>(null);

  // 滚动确保激活项可见
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.children[activeIndex] as HTMLElement | undefined;
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const renderIcon = (item: SlashItem) => {
    if (item.type === "skill") {
      return <Sparkles size={14} className="slash-cmd-picker__icon slash-cmd-picker__icon--skill" />;
    }
    switch (item.icon) {
      case "bot":
        return <Bot size={14} className="slash-cmd-picker__icon slash-cmd-picker__icon--bot" />;
      case "globe":
        return <Globe size={14} className="slash-cmd-picker__icon slash-cmd-picker__icon--globe" />;
      case "compress":
        return <Minimize2 size={14} className="slash-cmd-picker__icon slash-cmd-picker__icon--compress" />;
      case "plus":
        return <Plus size={14} className="slash-cmd-picker__icon slash-cmd-picker__icon--plus" />;
      default:
        return <Terminal size={14} className="slash-cmd-picker__icon" />;
    }
  };

  return (
    <div
      className="slash-cmd-picker"
      role="listbox"
      aria-label="快捷指令与技能选择"
      tabIndex={-1}
    >
      <div className="slash-cmd-picker__header">
        <div className="slash-cmd-picker__title">
          <Terminal size={13} />
          <span>快捷指令与技能</span>
          {query ? <span className="slash-cmd-picker__query-tag">/{query}</span> : null}
        </div>
        <div className="slash-cmd-picker__hints">
          <span className="slash-cmd-picker__hint-badge">↑↓ 移动</span>
          <span className="slash-cmd-picker__hint-badge">Enter 选取</span>
          <button
            type="button"
            className="slash-cmd-picker__close-btn"
            onClick={onClose}
            title="关闭浮层 (Esc)"
            aria-label="关闭快捷指令浮层"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <ul className="slash-cmd-picker__list" ref={listRef}>
        {filteredList.length === 0 ? (
          <li className="slash-cmd-picker__empty">未找到匹配的快捷指令或技能</li>
        ) : (
          filteredList.map((item, idx) => {
            const isSelected = idx === activeIndex;

            return (
              <li
                key={item.id}
                role="option"
                aria-label={item.name}
                data-command={item.command}
                tabIndex={0}
                aria-selected={isSelected}
                className={`slash-cmd-picker__item ${isSelected ? "slash-cmd-picker__item--selected" : ""}`}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => onSelect(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(item);
                  }
                }}
              >
                {renderIcon(item)}
                <div className="slash-cmd-picker__item-text">
                  <div className="slash-cmd-picker__item-top">
                    <span className="slash-cmd-picker__item-name">
                      <HighlightMatchedText text={item.name} query={query} />
                    </span>
                    <span className="slash-cmd-picker__item-cmd">
                      <HighlightMatchedText text={item.command} query={query} />
                    </span>
                    {item.type === "skill" ? (
                      <span
                        className={`slash-cmd-picker__status-tag ${
                          item.isActive ? "slash-cmd-picker__status-tag--active" : ""
                        }`}
                      >
                        {item.isActive ? "已加载" : "未加载"}
                      </span>
                    ) : item.badge ? (
                      <span className="slash-cmd-picker__badge">{item.badge}</span>
                    ) : null}
                  </div>
                  <div className="slash-cmd-picker__item-desc">
                    <HighlightMatchedText text={item.description} query={query} />
                  </div>
                </div>

                {item.type === "skill" && item.isActive ? (
                  <Check size={14} className="slash-cmd-picker__check" />
                ) : null}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
