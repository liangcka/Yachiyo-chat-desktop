import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFor } from "../../i18n/messages";
import * as desktopBridge from "../../services/desktop-bridge";
import { DesktopUpdateNotice } from "./DesktopUpdateNotice";

const check = vi.fn();
const relaunch = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunch() }));

const update = { version: "0.2.0", url: "https://github.com/liangcka/Yachiyo-chat-desktop/releases/tag/v0.2.0" };

function renderNotice() {
  const onDismiss = vi.fn();
  render(<DesktopUpdateNotice copy={copyFor("zh-CN")} update={update} onDismiss={onDismiss} />);
  return onDismiss;
}

beforeEach(() => {
  check.mockReset();
  relaunch.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("__TAURI_INTERNALS__", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DesktopUpdateNotice", () => {
  it("下载签名安装包时显示进度，安装后重启", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const downloadAndInstall = vi.fn((onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 200 } });
      onEvent({ event: "Progress", data: { chunkLength: 90 } });
      return new Promise<void>((resolve) => { release = resolve; });
    });
    check.mockResolvedValue({ downloadAndInstall });
    renderNotice();

    expect(screen.getByRole("status")).toHaveTextContent("发现新版本 v0.2.0");
    await user.click(screen.getByRole("button", { name: "立即更新" }));
    expect(await screen.findByText("正在下载更新 45%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
    release();
    await vi.waitFor(() => expect(relaunch).toHaveBeenCalledOnce());
  });

  it("发布没有签名包时打开下载页", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(desktopBridge, "openExternalUrl").mockResolvedValue(true);
    check.mockResolvedValue(null);
    renderNotice();
    await user.click(screen.getByRole("button", { name: "立即更新" }));
    await vi.waitFor(() => expect(openSpy).toHaveBeenCalledWith(update.url));
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("下载或校验失败时提示并提供下载页入口", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(desktopBridge, "openExternalUrl").mockResolvedValue(true);
    check.mockResolvedValue({ downloadAndInstall: vi.fn().mockRejectedValue(new Error("signature mismatch")) });
    const onDismiss = renderNotice();
    await user.click(screen.getByRole("button", { name: "立即更新" }));
    expect(await screen.findByText("更新失败，可前往下载页手动安装")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "前往下载" }));
    expect(openSpy).toHaveBeenCalledWith(update.url);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(relaunch).not.toHaveBeenCalled();
  });
});
