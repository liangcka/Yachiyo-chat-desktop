import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../../i18n/locale-context";
import { Search } from "lucide-react";

export interface PaletteCommand { id: string; label: string; group: string; run: () => void }

export function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const ja = useLocale() === "ja-JP";
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => commands.filter((command) => `${command.group} ${command.label}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [commands, query]);
  useEffect(() => {
    const previous = document.activeElement;
    input.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const choose = (command: PaletteCommand): void => { onClose(); command.run(); };
  return <div className="command-palette-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label={ja ? "コマンドパレット" : "命令面板"}>
      <div className="command-palette__input"><Search size={18} /><input ref={input} role="combobox" aria-label={ja ? "会話・モデル・設定を検索" : "搜索对话、模型或设置"} aria-controls="command-palette-results" aria-expanded="true" aria-activedescendant={results[index] ? `command-${results[index].id}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setIndex(0); }} placeholder={ja ? "会話・モデル・設定を検索…" : "搜索对话、模型或设置…"} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === "Tab") { event.preventDefault(); input.current?.focus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setIndex((value) => results.length ? (value + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length : 0); }
      if (event.key === "Enter" && event.target === input.current && results[index]) { event.preventDefault(); choose(results[index]); }
      }} /></div>
      <div id="command-palette-results" role="listbox" className="command-palette__results">
        {results.map((command, resultIndex) => <button id={`command-${command.id}`} type="button" role="option" aria-selected={resultIndex === index} tabIndex={-1} key={command.id} onPointerMove={() => setIndex(resultIndex)} onClick={() => choose(command)}><span>{command.label}</span><small>{command.group}</small></button>)}
        {results.length === 0 ? <p>{ja ? "一致する項目はありません" : "没有找到匹配内容"}</p> : null}
      </div>
    </section>
  </div>;
}
