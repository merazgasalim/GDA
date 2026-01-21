import { defineConfig } from 'prisma/config';

export default defineConfig({
  datasource: {
    db: {
      provider: 'sqlite',
      url: process.env.DATABASE_URL,
    },
  },
  engineType: 'binary', // Force legacy engine for Prisma 7.x with SQLite
});
