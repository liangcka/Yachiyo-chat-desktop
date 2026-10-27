import { useEffect, useState } from "react";
import { localVideoPath } from "../../features/file-reference/video-links";
import { useLocale } from "../../i18n/locale-context";
import { allowAssetFiles, assetUrl } from "../../services/desktop-bridge";

/** 本地视频先放行到 asset 协议再换成可加载地址；网页端或文件不存在时得到 undefined */
async function resolveLocalVideo(path: string): Promise<string | undefined> {
  const [file] = await allowAssetFiles([path]);
  return file === undefined ? undefined : assetUrl(file.path);
}

/** 消息里的视频：内联播放器，加载失败时退回为原链接文字，内容不会凭空消失 */
export function ChatVideo({ link }: { link: string }) {
  const ja = useLocale() === "ja-JP";
  const remote = /^https?:\/\//iu.test(link);
  const [resolved, setResolved] = useState<{ link: string; src?: string }>();
  const [failedLink, setFailedLink] = useState<string>();

  useEffect(() => {
    if (remote) return;
    let cancelled = false;
    const path = localVideoPath(link);
    void (path === undefined ? Promise.resolve(undefined) : resolveLocalVideo(path)).then((src) => {
      if (!cancelled) setResolved({ link, src });
    });
    return () => { cancelled = true; };
  }, [link, remote]);

  const src = remote ? link : resolved?.link === link ? resolved.src : undefined;
  const pending = !remote && resolved?.link !== link;
  if (failedLink === link || (!pending && src === undefined)) {
    return <p className="message-video__fallback">{ja ? "動画を読み込めません：" : "无法加载视频："}{link}</p>;
  }
  return (
    // 视频来自用户拖入或模型给出的任意文件，没有配套字幕可挂
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      className="message-video"
      controls
      preload="metadata"
      src={src}
      aria-label={ja ? "動画" : "视频"}
      onError={() => setFailedLink(link)}
    />
  );
}
