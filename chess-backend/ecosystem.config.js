// ─────────────────────────────────────────────────────────────────────────────
//  Chess Arena — PM2 Ecosystem Config
//  Usage: pm2 start ecosystem.config.js
//  Scales to max CPU cores, Redis adapter handles cross-instance socket rooms.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  apps: [{
    name: 'chess-arena',
    script: 'src/server.js',
    instances: 'max',          // Use all CPU cores (e2-standard-2 = 2, e2-standard-4 = 4)
    exec_mode: 'cluster',      // Node.js cluster mode — share port across instances
    max_memory_restart: '800M',
    node_args: '--max-old-space-size=768',

    env_production: {
      NODE_ENV: 'production',
      PORT: 4000,
    },

    // Logging
    out_file: '/var/log/chess-arena/out.log',
    error_file: '/var/log/chess-arena/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,

    // Graceful reload — zero-downtime deploys
    wait_ready: true,
    listen_timeout: 15000,
    kill_timeout: 10000,

    // Auto-restart on crash with exponential backoff
    autorestart: true,
    max_restarts: 10,
    restart_delay: 4000,
    exp_backoff_restart_delay: 100,

    // Watch (dev only — off in prod)
    watch: false,

    // Health metric collection
    pmx: true,
  }],
};
