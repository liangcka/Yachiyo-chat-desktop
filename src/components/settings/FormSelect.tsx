import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface FormSelectOption<T extends string> {
  value: T;
  label: string;
}

export interface FormSelectProps<T extends string> {
  id?: string;
  value: T;
  options: ReadonlyArray<FormSelectOption<T>>;
  onChange: (value: T) => void;
}

/** 表单下拉框：原生 select 的弹出层由系统绘制，在 WebView 弹窗里与主题割裂，这里改用自绘列表 */
export function FormSelect<T extends string>({ id, value, options, onChange }: FormSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const openMenu = () => {
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const choose = (next: T) => {
    onChange(next);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openMenu();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + step + options.length) % options.length);
    } else if ((e.key === "Enter" || e.key === " ") && open) {
      e.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option.value);
    } else if (e.key === "Escape" && open) {
      // 只收起下拉，不让外层弹窗的 Escape 监听把整个设置弹窗关掉
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="model-form-dropdown">
      <button
        id={id}
        type="button"
        className="model-form-input model-form-dropdown__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span>{options[selectedIndex]?.label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="model-form-dropdown__menu" role="listbox">
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                className={`model-form-dropdown__option${index === activeIndex ? " model-form-dropdown__option--active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option.value)}
              >
                <span>{option.label}</span>
                {selected ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
