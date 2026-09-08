import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AvatarCropModal } from "./AvatarCropModal";

describe("AvatarCropModal 圆形头像裁剪模态框", () => {
  const sampleImageSrc =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("当 open 为 false 时不渲染任何内容", () => {
    const { container } = render(
      <AvatarCropModal
        open={false}
        imageSrc={sampleImageSrc}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("当 open 为 true 时渲染裁剪画布与操作按钮", () => {
    render(
      <AvatarCropModal
        open={true}
        imageSrc={sampleImageSrc}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "裁剪圆形头像" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "裁剪圆形头像" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "缩放比例" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成裁剪" })).toBeInTheDocument();
  });

  it("点击取消或右上角关闭按钮触发 onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <AvatarCropModal
        open={true}
        imageSrc={sampleImageSrc}
        onClose={onClose}
        onConfirm={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "关闭裁剪" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("按 Esc 键触发 onClose", () => {
    const onClose = vi.fn();

    render(
      <AvatarCropModal
        open={true}
        imageSrc={sampleImageSrc}
        onClose={onClose}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
