import { WhaleHost } from "./host/whale-host";
import { WhaleStore } from "./host/store";
import { installWhaleBowl } from "./bowl";
import widgetScriptUrl from "./upstream/whale-widget.js?url";
import "./whale-widget.css";

const WHALE_PATH_PREFIX = "/dsh-whale/";
const HIDDEN_ATTRIBUTE = "data-whale-hidden";

let host: WhaleHost | null = null;

function whaleRequestUrl(input: RequestInfo | URL): URL | null {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, window.location.href);
  return url.origin === window.location.origin && url.pathname.startsWith(WHALE_PATH_PREFIX) ? url : null;
}

/**
 * 上游脚本用相对地址经 fetch 与 <img src> 访问宿主的 /dsh-whale/*，本应用没有这样的服务端路由，
 * 因此在页面内接管这两条通道，其余请求原样放行：
 * - fetch 交给本机宿主处理；
 * - <img> 的地址先由宿主取出图片再换成同源 Blob URL（期间不加载），挂件才能读像素做命中检测；
 *   取不到时设为空地址触发 error，挂件按上游逻辑降级。
 */
function interceptWhaleRequests(target: WhaleHost, nativeFetch: typeof fetch): void {
  window.fetch = (input, init) => {
    const url = whaleRequestUrl(input);
    return url ? target.handle(url, init) : nativeFetch(input, init);
  };

  const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  const { get, set } = descriptor ?? {};
  if (!get || !set) return;
  const requested = new WeakMap<HTMLImageElement, string>();
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get,
    set(this: HTMLImageElement, value: unknown) {
      if (typeof value !== "string" || !value.startsWith(WHALE_PATH_PREFIX)) {
        requested.delete(this);
        this.removeAttribute("data-whale-src");
        set.call(this, value);
        return;
      }
      // 换成 Blob URL 后 src 不再透露原地址，留一份供样式按当前角色显隐头顶的盆
      this.setAttribute("data-whale-src", value);
      requested.set(this, value);
      void target.imageUrl(value).then((url) => {
        if (requested.get(this) !== value) return;
        requested.delete(this);
        set.call(this, url ?? "");
      });
    },
  });
}

/** 首次启用时安装宿主并加载上游脚本；脚本自带单例守卫且无法卸载，之后只切换显隐 */
export function ensureWhaleWidget(): WhaleHost {
  if (host === null) {
    const nativeFetch = window.fetch.bind(window);
    host = new WhaleHost(new WhaleStore(), nativeFetch);
    interceptWhaleRequests(host, nativeFetch);
    installWhaleBowl();
    const script = document.createElement("script");
    script.src = widgetScriptUrl;
    document.head.append(script);
  }
  return host;
}

export function setWhaleWidgetVisible(visible: boolean): void {
  document.documentElement.toggleAttribute(HIDDEN_ATTRIBUTE, !visible);
  host?.setContext({ paused: !visible });
}
