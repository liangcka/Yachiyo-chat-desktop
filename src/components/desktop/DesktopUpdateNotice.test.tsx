import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { copyFor } from "../../i18n/messages";
import * as desktopBridge from "../../services/desktop-bridge";
import { DesktopUpdateNotice } from "./DesktopUpdateNotice";

describe("DesktopUpdateNotice", () => {
  it("opens the release page and dismisses itself", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(desktopBridge, "openExternalUrl").mockResolvedValue(true);
    const onDismiss = vi.fn();
    render(
      <DesktopUpdateNotice
        copy={copyFor("zh-CN")}
        update={{ version: "0.2.0", url: "https://github.com/liangcka/Yachiyo-chat-desktop/releases/tag/v0.2.0" }}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("发现新版本 v0.2.0");
    await user.click(screen.getByRole("button", { name: "前往下载" }));
    expect(openSpy).toHaveBeenCalledWith("https://github.com/liangcka/Yachiyo-chat-desktop/releases/tag/v0.2.0");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
