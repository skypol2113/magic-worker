module.exports = {
  apps: [{
    name: 'magic-worker',
    script: './index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      WORKER_VERSION: 'magicbox-worker-2.1.1'
    },
    // PM2 автоматически загружает .env файл из cwd
    cwd: '/opt/magic-worker',
    // Логи
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    // Авто-перезапуск
    autorestart: true,
    max_memory_restart: '350M',
    // Watch отключен для production
    watch: false
  }]
};
