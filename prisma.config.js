const { defineConfig } = require('prisma/config');

module.exports = defineConfig({
  datasource: {
    db: {
      provider: 'sqlite',
      url: process.env.DATABASE_URL,
    },
  },
  engineType: 'binary',
});
