import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

function Broken(): never {
  throw new Error("render exploded");
}

describe("AppErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces a crashed tree with a recoverable fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("界面出现了意外错误");
    expect(screen.getByText("render exploded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
  });

  it("renders children when nothing throws", () => {
    render(
      <AppErrorBoundary>
        <p>ok</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
