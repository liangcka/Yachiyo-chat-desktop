import { ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useClosing } from "../app/use-closing";
import type { UiCopy } from "../i18n/messages";
import type { WebSearchSettings } from "../services/web-search-settings";
import { type SkillDefinition } from "../skills";

export interface SkillsPanelProps {
  copy: UiCopy;
  skills: readonly SkillDefinition[];
  activeIds: readonly string[];
  open: boolean;
  onClose: () => void;
  onToggle: (id: string, next: boolean) => void;
  /** 联网搜索开关状态 */
  webSearchSettings: WebSearchSettings;
  /** 切换联网搜索设置 */
  onWebSearchSettingsChange: (partial: Partial<WebSearchSettings>) => void;
  /** 是否以嵌入模式渲染（不带全屏遮罩与外层弹窗容器，无缝融入设置中心/侧栏） */
  embedded?: boolean;
  /** 仅展示技能，隐藏联网搜索部分 */
  hideWebSearch?: boolean;
  /** 仅展示联网搜索部分 */
  onlyWebSearch?: boolean;
}

interface WebSearchItemProps {
  title: string;
  description: string;
  active: boolean;
  dataActive?: boolean;
  disabled?: boolean;
  isSubitem?: boolean;
  toggleLabel: string;
  disableLabel: string;
  enableLabel: string;
  onToggle: () => void;
}

function WebSearchItem({
  title,
  description,
  active,
  dataActive,
  disabled = false,
  isSubitem = false,
  toggleLabel,
  disableLabel,
  enableLabel,
  onToggle,
}: WebSearchItemProps) {
  const itemClassName = `skills-panel__item skills-panel__web-search-item${
    isSubitem ? " skills-panel__web-search-subitem" : ""
  }`;
  const isDataActive = dataActive ?? active;

  return (
    <li className={itemClassName} data-active={isDataActive ? "true" : undefined}>
      <div className="skills-panel__summary">
        <div className="skills-panel__meta">
          <strong className="skills-panel__name">{title}</strong>
          <span className="skills-panel__desc">{description}</span>
        </div>
        <button
          type="button"
          aria-label={`${toggleLabel}: ${title}`}
          aria-pressed={active}
          className={`settings-toggle-switch ${active ? "settings-toggle-switch--active" : ""} ${
            disabled ? "settings-toggle-switch--disabled" : ""
          }`}
          disabled={disabled}
          onClick={onToggle}
          title={active ? disableLabel : enableLabel}
        >
          <span className="settings-toggle-knob" />
        </button>
      </div>
    </li>
  );
}

export function SkillsPanel({
  copy,
  skills,
  activeIds,
  open,
  onClose,
  onToggle,
  webSearchSettings,
  onWebSearchSettingsChange,
  embedded = false,
  hideWebSearch = false,
  onlyWebSearch = false,
}: SkillsPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [expandedId, setExpandedId] = useState<string>();

  const { render, closing } = useClosing(open, 300);

  useEffect(() => {
    if (open && !embedded) closeRef.current?.focus();
  }, [open, embedded]);

  if (!render) return null;

  const { enabled, showSources, smart } = webSearchSettings;

  const innerContent = (
    <div className={`skills-panel-content ${embedded ? "skills-panel-content--embedded" : ""}`}>
      {!embedded && (
        <header className="skills-modal-card__header">
          <div className="skills-modal-card__title-wrap">
            <h3 className="skills-modal-card__title">{copy.skillsTitle}</h3>
            <p className="skills-modal-card__hint">{copy.skillsDescription}</p>
          </div>
          <button
            ref={closeRef}
            aria-label={copy.closeMenu}
            className="skills-modal-card__close"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>
      )}

      {!onlyWebSearch && skills.length > 0 && (
        <ul className="skills-panel__list">
          {skills.map((skill) => {
            const active = activeIds.includes(skill.id);
            const expanded = expandedId === skill.id;
            return (
              <li
                className="skills-panel__item"
                data-active={active ? "true" : undefined}
                key={skill.id}
              >
                <div className="skills-panel__summary">
                  <div className="skills-panel__meta">
                    <div className="skills-panel__title-row">
                      <strong className="skills-panel__name">{skill.name}</strong>
                      <button
                        aria-expanded={expanded}
                        className="skills-panel__expand"
                        onClick={() => setExpandedId(expanded ? undefined : skill.id)}
                        type="button"
                      >
                        <ChevronDown
                          aria-hidden="true"
                          data-expanded={expanded ? "true" : undefined}
                          size={13}
                          className={`skills-panel__expand-icon ${expanded ? "skills-panel__expand-icon--expanded" : ""}`}
                        />
                        <span>{expanded ? copy.skillHideContent : copy.skillViewContent}</span>
                      </button>
                    </div>
                    <span className="skills-panel__desc">{skill.description}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`${copy.skillToggleLabel}: ${skill.name}`}
                    aria-pressed={active}
                    className={`settings-toggle-switch ${active ? "settings-toggle-switch--active" : ""}`}
                    onClick={() => onToggle(skill.id, !active)}
                    title={active ? copy.skillDisable : copy.skillEnable}
                  >
                    <span className="settings-toggle-knob" />
                  </button>
                </div>
                {expanded ? (
                  <div className="skills-panel__content-wrap">
                    <pre className="skills-panel__content">{skill.content}</pre>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {!hideWebSearch && (
        <ul className="skills-panel__list skills-panel__web-search">
          <WebSearchItem
            active={enabled}
            disableLabel={copy.skillDisable}
            description={copy.webSearchDescription}
            enableLabel={copy.skillEnable}
            onToggle={() => onWebSearchSettingsChange({ enabled: !enabled })}
            title={copy.webSearchTitle}
            toggleLabel={copy.skillToggleLabel}
          />
          <WebSearchItem
            active={smart}
            dataActive={enabled && smart}
            disabled={!enabled}
            disableLabel={copy.skillDisable}
            description={copy.webSearchSmartDescription}
            enableLabel={copy.skillEnable}
            isSubitem
            onToggle={() => onWebSearchSettingsChange({ smart: !smart })}
            title={copy.webSearchSmart}
            toggleLabel={copy.skillToggleLabel}
          />
          <WebSearchItem
            active={showSources}
            dataActive={enabled && showSources}
            disabled={!enabled}
            disableLabel={copy.skillDisable}
            description={copy.webSearchShowSourcesDescription}
            enableLabel={copy.skillEnable}
            isSubitem
            onToggle={() => onWebSearchSettingsChange({ showSources: !showSources })}
            title={copy.webSearchShowSources}
            toggleLabel={copy.skillToggleLabel}
          />
        </ul>
      )}
    </div>
  );

  if (embedded) {
    return innerContent;
  }

  return (
    <div
      className={`model-modal-overlay skills-modal-overlay ${closing ? "model-modal-overlay--closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={copy.skillsTitle}
    >
      <button
        type="button"
        tabIndex={-1}
        className="model-modal-backdrop"
        onClick={onClose}
        aria-label={copy.closeMenu}
      />
      <div className="model-modal-card skills-modal-card">
        {innerContent}
      </div>
    </div>
  );
}
