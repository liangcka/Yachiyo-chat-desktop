import { useContext } from "react";
import type { Locale } from "../../domain/chat";
import { OpenReviewContext } from "./review-context";
import "../../styles/agent-tools.css";

export function FileChangeSummary({ paths, locale }: { paths: readonly string[]; locale: Locale }) {
  const openReview = useContext(OpenReviewContext);
  if (paths.length === 0) return null;
  const title = locale === "ja-JP" ? `${paths.length} 個のファイルを変更` : `修改了 ${paths.length} 个文件`;
  return <section className="file-change-summary" aria-label={title}>
    <p className="file-change-summary__title">{title}</p>
    <ul>{paths.map((path) => <li key={path}><code>{path}</code></li>)}</ul>
    <button className="file-change-summary__review" type="button" onClick={openReview} disabled={!openReview}>
      {locale === "ja-JP" ? "変更を確認" : "查看改动"}
    </button>
  </section>;
}
