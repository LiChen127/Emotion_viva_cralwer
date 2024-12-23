import dotenv from 'dotenv';
dotenv.config();

const isDev = process.env.NODE_ENV !== 'production';
console.log('当前环境:', {
  NODE_ENV: process.env.NODE_ENV,
  isDev,
  mongoUri: isDev ? 'mongodb://localhost:27018' : (process.env.MONGO_URI || 'mongodb://mongodb:27018'),
  redisUrl: isDev ? 'redis://localhost:6379' : (process.env.REDIS_URL || 'redis://redis:6379')
});

export const config = {
  mongodb: {
    uri: isDev
      ? 'mongodb://localhost:27018'  // 本地开发环境
      : 'mongodb://mongodb:27017',   // Docker 环境
    database: 'crawler_data',
    collection: 'jiandan_articles'
  },
  redis: {
    url: isDev
      ? 'redis://localhost:6379'     // 本地开发环境
      : 'redis://redis:6379'         // Docker 环境
  },
  rabbitmq: {
    url: isDev
      ? 'amqp://guest:guest@localhost:5672'
      : (process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672')
  },
  crawler: {
    delay: 1000,
    concurrent: 4,
    timeout: 10000,
    retryTimes: 3,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
};

console.log('当前环境配置:', {
  NODE_ENV: process.env.NODE_ENV,
  isDev,
  mongoUri: config.mongodb.uri,
  redisUrl: config.redis.url
}); 