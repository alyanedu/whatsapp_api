module.exports = {
  apps: [
    {
      name: 'whatsapp-otp-gateway',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      node_args: '--max-old-space-size=256',
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};