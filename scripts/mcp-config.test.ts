import { describe, expect, it } from 'vitest';
import { buildLocalMcpConfig, localMcpUrl } from '../apps/console/lib/mcp';

describe('local MCP connection configuration', () => {
  it('binds one MCP process to the selected worker without secrets', () => {
    const config = buildLocalMcpConfig({ workerId: 'worker-123' });
    expect(config.mcpServers.bagseven.env).toEqual({
      BAGSEVEN_MCP_WORKER: 'worker-123',
      BAGSEVEN_MCP_PORT: '4009',
      DAEMON_URL: 'http://127.0.0.1:4001',
    });
    expect(JSON.stringify(config)).not.toMatch(/PRIVATE|KEY|TOKEN|SECRET/i);
  });

  it('builds the existing local HTTP MCP endpoint', () => {
    expect(localMcpUrl()).toBe('http://127.0.0.1:4009/v1/mcp');
    expect(localMcpUrl(4019)).toBe('http://127.0.0.1:4019/v1/mcp');
  });
});
