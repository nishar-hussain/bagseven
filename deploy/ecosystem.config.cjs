/**
 * pm2 process manager config — keeps every AgentOS service alive and
 * auto-restarts it on crash, surviving across shell sessions.
 *
 *   pnpm pm2:start    # start all services (persistent)
 *   pnpm pm2:status   # status dashboard
 *   pnpm pm2:logs     # follow all logs
 *   pnpm pm2:stop     # stop everything
 */
module.exports = {
  apps: [
    { name: 'gateway', cwd: './services/gateway', script: 'node', args: '--env-file-if-exists=../../.env dist/index.js', autorestart: true, max_restarts: 20, time: true },
    { name: 'identity', cwd: './services/identity', script: 'node', args: '--env-file-if-exists=../../.env dist/index.js', autorestart: true, max_restarts: 20, time: true },
    { name: 'treasury', cwd: './services/treasury', script: 'node', args: '--env-file-if-exists=../../.env dist/index.js', autorestart: true, max_restarts: 20, time: true },
    { name: 'policy', cwd: './services/policy', script: 'node', args: '--env-file-if-exists=../../.env dist/index.js', autorestart: true, max_restarts: 20, time: true },
    { name: 'verification', cwd: './services/verification', script: 'node', args: '--env-file-if-exists=../../.env dist/index.js', autorestart: true, max_restarts: 20, time: true },
    { name: 'marketplace-tools', cwd: './services/marketplace-tools', script: 'node', args: '--env-file-if-exists=../../.env dist/index.js', autorestart: true, max_restarts: 20, time: true },
    { name: 'payments', cwd: './services/payments', script: 'node', args: '--env-file-if-exists=../../.env dist/index.js', autorestart: true, max_restarts: 20, time: true },
    { name: 'demo-provider', cwd: './services/demo-provider', script: 'node', args: '--env-file-if-exists=../../.env dist/index.js', autorestart: true, max_restarts: 20, time: true },
    { name: 'console', cwd: './apps/console', script: 'node', args: 'node_modules/next/dist/bin/next start -p 3000', autorestart: true, max_restarts: 20, time: true },
  ],
};