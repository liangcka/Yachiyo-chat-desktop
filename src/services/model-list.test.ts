import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModelList, parseModelIds } from "./model-list";

const isDesktopApp = vi.hoisted(() => vi.fn(() => false));
vi.mock("./app-platform", () => ({ isDesktopApp }));
const apiFetch = vi.hoisted(() => vi.fn<(path: string, init?: RequestInit) => Promise<Response>>());
vi.mock("./api-origins", () => ({ apiFetch }));

const KEY = "sk-test-abcdefghijklmnopqrstuvwxyz0123";

afterEach(() => {
  vi.unstubAllGlobals();
  isDesktopApp.mockReset().mockReturnValue(false);
  apiFetch.mockReset();
});

describe("parseModelIds", () => {
  it("collects, trims, dedups and sorts data[].id", () => {
    expect(
      parseModelIds({ data: [{ id: "qwen-turbo" }, { id: " gpt-4o " }, { id: "" }, { name: "x" }, { id: 1 }, { id: "gpt-4o" }] }),
    ).toEqual(["gpt-4o", "qwen-turbo"]);
  });

  it("returns an empty list for unexpected shapes", () => {
    expect(parseModelIds(null)).toEqual([]);
    expect(parseModelIds({ models: ["a"] })).toEqual([]);
  });
});

describe("fetchModelList", () => {
  it("queries the endpoint directly in the browser", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ id: "b" }, { id: "a" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchModelList({ baseUrl: "https://llm.example.com/v1/", apiKey: KEY })).resolves.toEqual(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledWith("https://llm.example.com/v1/models", {
      headers: { accept: "application/json", authorization: `Bearer ${KEY}` },
    });
  });

  it("goes through the desktop gateway with the stored-key slot when no key is typed", async () => {
    isDesktopApp.mockReturnValue(true);
    apiFetch.mockResolvedValueOnce(Response.json({ models: ["m1", 2, "m2"] }));

    await expect(fetchModelList({ baseUrl: "https://llm.example.com/v1", apiKey: " ", slot: "openai~abc" })).resolves.toEqual([
      "m1",
      "m2",
    ]);
    const [path, init] = apiFetch.mock.calls[0]!;
    expect(path).toBe("/api/models");
    expect(JSON.parse(String(init?.body))).toEqual({ baseUrl: "https://llm.example.com/v1", slot: "openai~abc" });
  });

  it("throws when the upstream rejects the request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    await expect(fetchModelList({ baseUrl: "https://llm.example.com/v1", apiKey: KEY })).rejects.toThrow("401");
  });
});
