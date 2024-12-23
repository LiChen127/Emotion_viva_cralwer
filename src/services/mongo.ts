import { MongoClient, Collection } from 'mongodb';
import { config } from '../config';
import { Article } from '../types';
import { logger } from '../utils/logger';

export class MongoService {
  private client: MongoClient;
  private collection: Collection<Article> | undefined;
  private isConnected: boolean = false;

  constructor() {
    this.client = new MongoClient(config.mongodb.uri);
    this.setup();
  }

  private async setup() {
    try {
      await this.client.connect();
      logger.info('MongoDB 正在连接...', {
        uri: config.mongodb.uri,
        database: config.mongodb.database,
        collection: config.mongodb.collection
      });

      const db = this.client.db(config.mongodb.database);
      this.collection = db.collection(config.mongodb.collection);

      // 测试连接
      await db.command({ ping: 1 });
      this.isConnected = true;
      logger.info(`MongoDB 连接成功: ${config.mongodb.uri}`);

      // 创建索引
      await this.collection.createIndex({ url: 1 }, { unique: true });
      logger.info(`MongoDB 索引创建成功: ${config.mongodb.collection}`);
    } catch (error) {
      this.isConnected = false;
      logger.error('MongoDB 连接失败:', error);
      throw error;
    }
  }

  async saveArticle(article: Article) {
    try {
      if (!this.isConnected) {
        logger.error('MongoDB 未连接');
        await this.setup(); // 尝试重新连接
      }

      if (!this.collection) {
        throw new Error('MongoDB collection 未初始化');
      }

      logger.info(`尝试保存文章: ${article.title}`, {
        url: article.url,
        contentLength: article.content?.length || 0,
        database: config.mongodb.database,
        collection: config.mongodb.collection
      });

      // 先检查文章是否已存在
      const existing = await this.collection.findOne({ url: article.url });
      logger.debug('检查文章是否存在:', {
        url: article.url,
        exists: !!existing
      });

      const result = await this.collection.updateOne(
        { url: article.url },
        {
          $set: {
            ...article,
            lastUpdated: new Date()  // 添加更新时间
          }
        },
        { upsert: true }
      );

      logger.info(`MongoDB 保存结果:`, {
        title: article.title,
        matched: result.matchedCount,
        modified: result.modifiedCount,
        upserted: result.upsertedId,
        url: article.url,
        database: config.mongodb.database,
        collection: config.mongodb.collection
      });

      // 立即验证保存
      const saved = await this.collection.findOne({ url: article.url });
      if (!saved) {
        throw new Error(`文章保存失败: ${article.title}`);
      }

      logger.info(`文章保存成功: ${article.title}`, {
        id: saved._id,
        url: saved.url,
        contentLength: saved.content?.length || 0
      });

      return saved;
    } catch (error) {
      logger.error(`MongoDB 保存失败:`, {
        error: error instanceof Error ? error.message : error,
        title: article.title,
        url: article.url,
        stack: error instanceof Error ? error.stack : undefined,
        database: config.mongodb.database,
        collection: config.mongodb.collection
      });
      throw error;
    }
  }
} 