import type * as Monaco from "monaco-editor";

/**
 * Monaco 懒加载单例：仅在实际打开编辑器视图时才拉取 Monaco 主包与 worker，
 * Web/PWA 首屏不承担其体积成本。
 * Vite 8（rolldown）不支持 `?worker` 导入查询，worker 采用官方 `new URL` 内联字面量形式打包；
 * 路径须写死在 new URL 内（插件静态分析），相对本文件定位 node_modules。
 */
let monacoPromise: Promise<typeof import("monaco-editor")> | null = null;

export function loadMonaco(): Promise<typeof import("monaco-editor")> {
  if (!monacoPromise) {
    monacoPromise = (async () => {
      const monaco = await import("monaco-editor");

      self.MonacoEnvironment = {
        getWorker(_workerId: string, label: string): Worker {
          if (label === "typescript" || label === "javascript") {
            return new Worker(
              new URL("../../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url),
              { type: "module" },
            );
          }
          if (label === "css" || label === "scss" || label === "less") {
            return new Worker(
              new URL("../../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url),
              { type: "module" },
            );
          }
          if (label === "html" || label === "handlebars" || label === "razor") {
            return new Worker(
              new URL("../../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url),
              { type: "module" },
            );
          }
          if (label === "json") {
            return new Worker(
              new URL("../../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url),
              { type: "module" },
            );
          }
          return new Worker(
            new URL("../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
            { type: "module" },
          );
        },
      };

      defineYachiyoThemes(monaco);
      return monaco;
    })();
  }
  return monacoPromise;
}

/** 主题名与全局主题状态（"light" | "dark"）直接对齐 */
export type EditorThemeName = "yachiyo-dark" | "yachiyo-light";

export function editorThemeFor(resolvedTheme: "light" | "dark"): EditorThemeName {
  return resolvedTheme === "light" ? "yachiyo-light" : "yachiyo-dark";
}

/**
 * 星空玻璃主题：色板对齐 src/styles/tokens.css（深海蓝 #040713/#071436/#0b1a42 + 品牌蓝 #4b8bf5）。
 * token 色取蓝紫系，与暗色玻璃底协调。
 */
function defineYachiyoThemes(monaco: typeof Monaco): void {
  monaco.editor.defineTheme("yachiyo-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "5f7292", fontStyle: "italic" },
      { token: "keyword", foreground: "82aaff" },
      { token: "string", foreground: "c3e88d" },
      { token: "number", foreground: "f78c6c" },
      { token: "type", foreground: "ffcb6b" },
      { token: "type.identifier", foreground: "ffcb6b" },
      { token: "identifier", foreground: "e8ecf5" },
      { token: "delimiter", foreground: "aebbd2" },
      { token: "tag", foreground: "82d8ff" },
      { token: "attribute.name", foreground: "ffcb6b" },
      { token: "attribute.value", foreground: "c3e88d" },
    ],
    colors: {
      "editor.background": "#060d24",
      "editor.foreground": "#e8ecf5",
      "editorLineNumber.foreground": "#3d4f78",
      "editorLineNumber.activeForeground": "#82aaff",
      "editor.selectionBackground": "#194b8d66",
      "editor.inactiveSelectionBackground": "#10366d44",
      "editor.lineHighlightBackground": "#0b1a4255",
      "editorCursor.foreground": "#4b8bf5",
      "editorIndentGuide.background1": "#0b1a4266",
      "editorIndentGuide.activeBackground1": "#3d4f78",
      "editorWidget.background": "#071436",
      "editorWidget.border": "#87acec24",
      "editorSuggestWidget.background": "#071436",
      "editorSuggestWidget.selectedBackground": "#10366d66",
      "editorHoverWidget.background": "#071436",
      "scrollbarSlider.background": "#b1c5e538",
      "scrollbarSlider.hoverBackground": "#b1c5e55c",
      "scrollbarSlider.activeBackground": "#b1c5e57a",
      "diffEditor.insertedTextBackground": "#3fb9501f",
      "diffEditor.removedTextBackground": "#e5534b1f",
    },
  });

  monaco.editor.defineTheme("yachiyo-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8b949e", fontStyle: "italic" },
      { token: "keyword", foreground: "0550ae" },
      { token: "string", foreground: "116329" },
      { token: "number", foreground: "953800" },
      { token: "type", foreground: "953800" },
      { token: "type.identifier", foreground: "953800" },
      { token: "identifier", foreground: "24292f" },
      { token: "tag", foreground: "0969da" },
      { token: "attribute.name", foreground: "0550ae" },
      { token: "attribute.value", foreground: "116329" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#24292f",
      "editorLineNumber.foreground": "#8fa0c0",
      "editorLineNumber.activeForeground": "#10366d",
      "editor.selectionBackground": "#a7c7f866",
      "editor.lineHighlightBackground": "#f1f5f9",
      "editorCursor.foreground": "#10366d",
      "editorIndentGuide.background1": "#e2e8f0",
      "editorIndentGuide.activeBackground1": "#b8c4d9",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#94a3b833",
      "editorSuggestWidget.background": "#ffffff",
      "editorSuggestWidget.selectedBackground": "#10366d1a",
      "editorHoverWidget.background": "#ffffff",
      "scrollbarSlider.background": "#94a3b838",
      "scrollbarSlider.hoverBackground": "#94a3b85c",
      "scrollbarSlider.activeBackground": "#94a3b87a",
      "diffEditor.insertedTextBackground": "#1a7f371a",
      "diffEditor.removedTextBackground": "#bf13231a",
    },
  });
}
