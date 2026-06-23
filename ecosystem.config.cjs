module.exports = {
  apps: [
    {
      name: 'timberhub-whatsapp-api',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};