import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Live2dWidget } from "./Live2dWidget";
import type { Live2dSettings } from "../../services/live2d-settings";

describe("Live2dWidget", () => {
  const baseSettings: Live2dSettings = {
    enabled: true,
    position: "left",
    preload: "IDLE",
    widthLimit: 0, // 测试中设为 0 避免受 jsdom 默认宽度的限制
    characterIndex: 0,
    outfitIndex: 0,
    scale: 1.0,
    opacity: 1.0,
    aiReactivity: true,
    soundEnabled: false,
  };

  beforeEach(() => {
    // 模拟 window.initWidget
    window.initWidget = vi.fn(() => {
      const waifu = document.createElement("div");
      waifu.id = "waifu";
      document.body.appendChild(waifu);
    });
  });

  afterEach(() => {
    document.getElementById("waifu")?.remove();
    document.getElementById("waifu-toggle")?.remove();
    delete window.initWidget;
    vi.restoreAllMocks();
  });

  it("does not initialize when enabled is false", async () => {
    render(<Live2dWidget settings={{ ...baseSettings, enabled: false }} />);

    expect(window.initWidget).not.toHaveBeenCalled();
    expect(document.getElementById("waifu")).toBeNull();
  });

  it("cleans up waifu dom elements on unmount", async () => {
    const waifu = document.createElement("div");
    waifu.id = "waifu";
    document.body.appendChild(waifu);

    const toggle = document.createElement("div");
    toggle.id = "waifu-toggle";
    document.body.appendChild(toggle);

    const { unmount } = render(<Live2dWidget settings={baseSettings} />);
    unmount();

    expect(document.getElementById("waifu")).toBeNull();
    expect(document.getElementById("waifu-toggle")).toBeNull();
  });

  it("applies right position class when configured", async () => {
    const { rerender } = render(
      <Live2dWidget settings={{ ...baseSettings, position: "left" }} />,
    );

    await waitFor(() => {
      const waifu = document.getElementById("waifu");
      expect(waifu?.classList.contains("waifu-position-left")).toBe(true);
    });

    rerender(<Live2dWidget settings={{ ...baseSettings, position: "right" }} />);

    await waitFor(() => {
      const waifu = document.getElementById("waifu");
      expect(waifu?.classList.contains("waifu-position-right")).toBe(true);
    });
  });

  it("applies custom position and coordinates correctly", async () => {
    render(
      <Live2dWidget
        settings={{
          ...baseSettings,
          position: "custom",
          customPosition: { x: 240, y: 380 },
        }}
      />,
    );

    await waitFor(() => {
      const waifu = document.getElementById("waifu");
      expect(waifu?.classList.contains("waifu-position-custom")).toBe(true);
      expect(waifu?.style.left).toBe("240px");
      expect(waifu?.style.top).toBe("380px");
    });
  });

  it("applies scale and opacity style properties", async () => {
    render(
      <Live2dWidget
        settings={{
          ...baseSettings,
          scale: 1.2,
          opacity: 0.8,
        }}
      />,
    );

    await waitFor(() => {
      const waifu = document.getElementById("waifu");
      expect(waifu?.style.getPropertyValue("--mascot-scale")).toBe("1.2");
      expect(waifu?.style.getPropertyValue("--mascot-opacity")).toBe("0.8");
    });
  });

  it("renders modern quick bar and triggers home navigation", async () => {
    const onSettingsChange = vi.fn();
    render(
      <Live2dWidget
        settings={{
          ...baseSettings,
          position: "custom",
          homePosition: "right",
        }}
        onSettingsChange={onSettingsChange}
      />,
    );

    await waitFor(() => {
      const homeBtn = document.querySelector('button[aria-label="归位回家"]');
      expect(homeBtn).not.toBeNull();
    });

    const homeBtn = document.querySelector('button[aria-label="归位回家"]') as HTMLButtonElement;
    fireEvent.click(homeBtn);

    expect(onSettingsChange).toHaveBeenCalledWith({
      position: "right",
    });
  });

  it("switches to next character when clicking next character button", async () => {
    const onSettingsChange = vi.fn();
    render(
      <Live2dWidget
        settings={{
          ...baseSettings,
          characterIndex: 0, // 高松灯 -> 切换为 1: 千早爱音
        }}
        onSettingsChange={onSettingsChange}
      />,
    );

    await waitFor(() => {
      const nextCharBtn = document.querySelector('button[aria-label="切换角色"]');
      expect(nextCharBtn).not.toBeNull();
    });

    const nextCharBtn = document.querySelector('button[aria-label="切换角色"]') as HTMLButtonElement;
    fireEvent.click(nextCharBtn);

    expect(onSettingsChange).toHaveBeenCalledWith({
      characterIndex: 1,
      outfitIndex: 0,
    });
  });

  it("opens outfit and character workshop modal and selects new outfit", async () => {
    const onSettingsChange = vi.fn();
    render(
      <Live2dWidget
        settings={baseSettings}
        onSettingsChange={onSettingsChange}
      />,
    );

    await waitFor(() => {
      const outfitBtn = document.querySelector('button[aria-label="换装选择"]');
      expect(outfitBtn).not.toBeNull();
    });

    const outfitBtn = document.querySelector('button[aria-label="换装选择"]') as HTMLButtonElement;
    fireEvent.click(outfitBtn);

    await waitFor(() => {
      expect(document.querySelector(".live2d-picker-modal")).not.toBeNull();
    });

    const outfitCards = document.querySelectorAll(".live2d-outfit-card");
    expect(outfitCards.length).toBeGreaterThan(0);
    fireEvent.click(outfitCards[1]);

    expect(onSettingsChange).toHaveBeenCalledWith({
      characterIndex: 0,
      outfitIndex: 1,
    });
  });

  it("reacts to AI streaming phase with speech bubble", async () => {
    const { rerender } = render(
      <Live2dWidget
        settings={baseSettings}
        chatPhase="idle"
      />,
    );

    await waitFor(() => {
      expect(document.getElementById("waifu")).not.toBeNull();
    });

    rerender(
      <Live2dWidget
        settings={baseSettings}
        chatPhase="streaming"
      />,
    );

    await waitFor(() => {
      const bubble = document.querySelector(".live2d-speech-bubble");
      expect(bubble).not.toBeNull();
      expect(bubble?.classList.contains("live2d-speech-bubble--active")).toBe(true);
    });
  });

  it("handles dragging and emits custom position upon release", async () => {
    const onSettingsChange = vi.fn();
    render(
      <Live2dWidget
        settings={baseSettings}
        onSettingsChange={onSettingsChange}
      />,
    );

    await waitFor(() => {
      expect(document.getElementById("waifu")).not.toBeNull();
    });

    const waifu = document.getElementById("waifu")!;
    waifu.getBoundingClientRect = vi.fn(() => ({
      width: 200,
      height: 200,
      top: 100,
      left: 100,
      right: 300,
      bottom: 300,
      x: 100,
      y: 100,
      toJSON: () => {},
    }));

    waifu.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 120,
        clientY: 120,
        pointerId: 1,
      }),
    );

    waifu.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: 200,
        clientY: 250,
        pointerId: 1,
      }),
    );

    waifu.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        clientX: 200,
        clientY: 250,
        pointerId: 1,
      }),
    );

    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        position: "custom",
        customPosition: expect.any(Object),
      }),
    );
  });
});
