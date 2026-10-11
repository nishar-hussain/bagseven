export interface LocalMcpConfigOptions {
  workerId: string;
  daemonUrl?: string;
  port?: number;
}

/**
 * Build a safe local MCP configuration. It intentionally contains no private
 * key, payer key, executor key, or service token.
 */
export function buildLocalMcpConfig({ workerId, daemonUrl = 'http://127.0.0.1:4001', port = 4009 }: LocalMcpConfigOptions) {
  return {
    mcpServers: {
      bagseven: {
        command: 'pnpm',
        args: ['bagseven-mcp'],
        env: {
          BAGSEVEN_MCP_WORKER: workerId,
          BAGSEVEN_MCP_PORT: String(port),
          DAEMON_URL: daemonUrl,
        },
      },
    },
  };
}

export function localMcpUrl(port = 4009): string {
  return `http://127.0.0.1:${port}/v1/mcp`;
}
