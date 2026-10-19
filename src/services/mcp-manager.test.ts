import { describe, expect, it, vi } from "vitest";
import {
  deleteMcpServer,
  listMcpServers,
  MCP_PRESETS,
  type McpServerConfig,
  parseMcpToolName,
  saveMcpServer,
  testMcpServer,
  toggleMcpServer,
} from "./mcp-manager";

describe("mcp-manager service", () => {
  it("parseMcpToolName 准确解析普通工具与 MCP 工具", () => {
    expect(parseMcpToolName("read_file")).toEqual({ isMcp: false });
    expect(parseMcpToolName("run_command")).toEqual({ isMcp: false });

    const mcpParsed = parseMcpToolName("mcp__sqlite__query");
    expect(mcpParsed.isMcp).toBe(true);
    expect(mcpParsed.serverId).toBe("sqlite");
    expect(mcpParsed.originalToolName).toBe("query");

    const multiUnderscore = parseMcpToolName("mcp__github__create_issue");
    expect(multiUnderscore.isMcp).toBe(true);
    expect(multiUnderscore.serverId).toBe("github");
    expect(multiUnderscore.originalToolName).toBe("create_issue");
  });

  it("MCP_PRESETS 包含常见数据库与开发者工具且配置完整", () => {
    expect(MCP_PRESETS.length).toBeGreaterThanOrEqual(4);
    const sqlite = MCP_PRESETS.find((p) => p.id === "sqlite");
    expect(sqlite).toBeDefined();
    expect(sqlite?.config.transport.type).toBe("stdio");

    const sse = MCP_PRESETS.find((p) => p.id === "remote_sse");
    expect(sse).toBeDefined();
    expect(sse?.config.transport.type).toBe("sse");
  });

  it("在 Web fallback 环境下通过 HTTP API 正确调用接口", async () => {
    const mockServers: McpServerConfig[] = [
      {
        id: "test",
        name: "Test Server",
        enabled: true,
        transport: { type: "stdio", command: "node", args: ["server.js"] },
      },
    ];

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/mcp/servers") && (!init || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ servers: mockServers }),
        });
      }
      if (url.includes("/api/mcp/servers") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      }
      if (url.includes("/api/mcp/test") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, tools: [{ name: "ping", inputSchema: {} }] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    }) as unknown as typeof fetch;

    const list = await listMcpServers();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("test");

    const saved = await saveMcpServer(mockServers[0]!);
    expect(saved).toBe(true);

    const testRes = await testMcpServer(mockServers[0]!);
    expect(testRes.success).toBe(true);
    expect(testRes.tools).toHaveLength(1);

    const toggled = await toggleMcpServer("test", false);
    expect(toggled).toBe(true);

    const deleted = await deleteMcpServer("test");
    expect(deleted).toBe(true);
  });
});
