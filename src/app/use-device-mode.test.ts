import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDeviceMode } from "./use-device-mode";

describe("useDeviceMode", () => {
  it("returns desktop mode across environments", () => {
    const { result } = renderHook(() => useDeviceMode());
    expect(result.current).toBe("desktop");
  });
});
