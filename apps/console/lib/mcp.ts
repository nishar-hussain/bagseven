export interface LocalMcpConfigOptions {
  workerId: string;
  daemonUrl?: string;
  port?: number;
}

export interface ClaudeDesktopMcpConfigOptions {
  workerId: string;
  repositoryPath: string;
  daemonUrl?: string;
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

/**
 * Claude Desktop launches local MCP servers through stdio. The repository
 * path is required because Claude does not inherit the user's shell cwd.
 * The MCP process loads its local .env itself; no secret is serialized here.
 */
export function buildClaudeDesktopConfig({ workerId, repositoryPath, daemonUrl = 'http://127.0.0.1:4001' }: ClaudeDesktopMcpConfigOptions) {
  return {
    mcpServers: {
      bagseven: {
        command: 'pnpm',
        args: ['--dir', repositoryPath, 'bagseven-mcp'],
        env: {
          BAGSEVEN_MCP_WORKER: workerId,
          DAEMON_URL: daemonUrl,
        },
      },
    },
  };
}
