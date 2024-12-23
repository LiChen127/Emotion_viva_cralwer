import axios from 'axios';
import * as cheerio from 'cheerio';
import { Article } from '../types';
import { config } from '../config';
import { MongoService } from './mongo';
import { logger } from '../utils/logger';
import { generateUserAgent } from '../utils/userAgent';
import Queue from 'bull';

export class CrawlerService {
  private mongoService: MongoService;
  private crawlQueue: Queue.Queue;
  private readonly cookies: string[] = [
    '7d0c05cfbd949a8750e2b03c4de48209|1734706167|1734706167',
  ];

  private readonly headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Pragma': 'no-cache'
  };

  constructor() {
    this.mongoService = new MongoService();

    // 添加 Redis 连接调试
    logger.info('正在初始化 Redis 队列...', {
      redisUrl: config.redis.url
    });

    this.crawlQueue = new Queue('crawler-queue', {
      redis: {
        port: 6379,
        host: 'localhost',
        maxRetriesPerRequest: 3
      }
    });

    // 验证 Redis 连接
    this.crawlQueue.client.on('connect', () => {
      logger.info('Redis 连接成功');
    });

    this.crawlQueue.client.on('error', (error) => {
      logger.error('Redis 连接错误:', error);
    });

    this.setupQueue();
  }

  private getRandomCookie(): string {
    return this.cookies[Math.floor(Math.random() * this.cookies.length)];
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getRandomDelay(): number {
    // 随机延迟 2-5 秒
    return Math.floor(Math.random() * 3000) + 2000;
  }

  private async crawlWithRetry(url: string, options: any, retries = 3): Promise<any> {
    try {
      // 随机延迟
      await this.delay(this.getRandomDelay());

      const response = await axios({
        url,
        ...options,
        headers: {
          ...this.headers,
          'User-Agent': generateUserAgent(),
          'Cookie': this.getRandomCookie(),
          'Referer': 'https://www.jiandanxinli.com/',
          ...options.headers
        },
        // 使用代理（如果有的话）
        // proxy: {
        //   host: 'proxy.example.com',
        //   port: 8080
        // },
        timeout: config.crawler.timeout,
        validateStatus: (status) => status < 500 // 允许除了 5xx 之外的状态码
      });

      // 检查是否被封禁或需要验证码
      if (response.data.includes('验证码') || response.data.includes('blocked')) {
        throw new Error('被封禁/需要验证码');
      }

      return response;
    } catch (error) {
      if (retries > 0) {
        logger.warn(`重试~~~ ${4 - retries}/3 for ${url}`);
        await this.delay(5000); // 失败后等待更长时间
        return this.crawlWithRetry(url, options, retries - 1);
      }
      throw error;
    }
  }

  private setupQueue() {
    this.crawlQueue.process(async (job) => {
      const { url, type } = job.data;
      logger.info(`处理${type}任务: ${url}`);

      try {
        if (type === 'list') {
          await this.crawlList(url);
        } else {
          await this.crawlDetail(url);
        }
      } catch (error) {
        logger.error(`任务处理失败: ${error}`);
        throw error;
      }
    });

    // 添加队列事件监听
    this.crawlQueue.on('error', (error) => {
      logger.error('队列错误:', error);
    });

    this.crawlQueue.on('waiting', (jobId) => {
      logger.info(`任务等待中: ${jobId}`);
    });

    this.crawlQueue.on('active', (job) => {
      logger.info(`任务开始处理: ${job.id}`);
    });
  }

  async start() {
    logger.info('开始爬虫...');
    try {
      // 清理旧任务
      await this.crawlQueue.clean(0, 'completed');
      await this.crawlQueue.clean(0, 'failed');

      // 添加初始任务
      const job = await this.crawlQueue.add({
        url: 'https://www.jiandanxinli.com/knowledge',
        type: 'list'
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      });

      logger.info(`添加初始爬虫任务到队列: ${job.id}`);

      // 检查队列状态
      const counts = await Promise.all([
        this.crawlQueue.getActiveCount(),
        this.crawlQueue.getWaitingCount(),
        this.crawlQueue.getCompletedCount(),
        this.crawlQueue.getFailedCount()
      ]);

      logger.info('队列状态:', {
        active: counts[0],
        waiting: counts[1],
        completed: counts[2],
        failed: counts[3]
      });

    } catch (error) {
      logger.error(`爬虫启动失败:`, error);
      throw error;
    }
  }

  private async crawlList(url: string): Promise<void> {
    try {
      logger.info(`爬取列表页: ${url}`);
      const response = await this.crawlWithRetry(url, {
        method: 'GET'
      });

      logger.info(`从${url}获取响应, 状态: ${response.status}`);
      const $ = cheerio.load(response.data);

      // 直接使用 list-item list-item--large 选择器
      const articles = $('a.list-item.list-item--large');

      if (articles.length === 0) {
        logger.debug('HTML结构:', {
          html: $.html().substring(0, 1000),
          listItems: $('a.list-item').length,
          largeItems: $('.list-item--large').length,
          allAnchors: $('a').length
        });
        throw new Error('未找到文章');
      }

      logger.info(`找到${articles.length}篇文章: ${url}`);

      // 遍历文章并提取信息
      articles.each((index, element) => {
        const article = $(element);
        const articleUrl = article.attr('href');

        if (!articleUrl) {
          logger.warn('文章URL未找到:', article.html()?.substring(0, 200));
          return;
        }

        // 提取文章数据
        const articleData = {
          url: articleUrl,
          title: article.text().trim(),
        };

        logger.info(`找到文章: ${articleData.title} at ${articleData.url}`);

        // 添加到详情页爬取队列
        this.crawlQueue.add({
          url: new URL(articleUrl, url).href,
          type: 'detail'
        }, {
          delay: this.getRandomDelay(),
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        });
      });

      // 处理分页 - 使用 div.box.paginate 内的链接
      const nextPage = $('div.box.paginate').find('a').last().attr('href');
      if (nextPage) {
        logger.info(`找到下一页: ${nextPage}`);
        await this.crawlQueue.add({
          url: new URL(nextPage, url).href,
          type: 'list'
        }, {
          delay: this.getRandomDelay()
        });
      }

    } catch (error) {
      logger.error(`爬取列表页${url}失败: ${error}`);
      if (axios.isAxiosError(error)) {
        logger.error('Axios error details:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data ? error.response.data.substring(0, 500) : null
        });
      }
      logger.error('错误详情:', error instanceof Error ? error.stack : error);
    }
  }

  private async crawlDetail(url: string): Promise<void> {
    try {
      logger.info(`爬取详情页: ${url}`);
      const response = await this.crawlWithRetry(url, {
        method: 'GET'
      });

      const $ = cheerio.load(response.data);

      // 根据 URL 判断文章类型
      const isPost = url.includes('/posts/');
      const isMaterial = url.includes('/materials/');

      // 根据不同类型文章使用不同的选择器
      let article: Article;

      if (isPost) {
        // 文章页面
        article = {
          title: $('.post-title h1, .title h1').text().trim(),
          url: url,
          summary: $('.post-summary, .summary').text().trim(),
          tags: $('.post-tags .tag, .tags span').map((_, el) => $(el).text().trim()).get(),
          category: $('.post-category, .category').text().trim(),
          readCount: this.parseNumber($('.post-stats .read-count, .read-count').text()),
          likeCount: this.parseNumber($('.post-stats .like-count, .like-count').text()),
          commentCount: this.parseNumber($('.post-stats .comment-count, .comment-count').text()),
          content: $('.common-detail-article, .common-detail').html() || '',
          contentText: $('.common-detail-article, .common-detail').text().trim(),
          author: $('.post-author .name, .author .name').text().trim(),
          publishTime: $('.post-time, .time').text().trim(),
          wordCount: this.parseNumber($('.post-stats .word-count, .word-count').text()),
          crawlTime: new Date().toISOString()
        };
      } else if (isMaterial) {
        // 材料页面
        article = {
          title: $('h1.title, .material-title').text().trim() || $('title').text().split('-')[0].trim(),
          url: url,
          summary: $('.material-summary, meta[name="description"]').attr('content') || '',
          tags: $('.material-tags .tag, meta[name="keywords"]').attr('content')?.split(',') || [],
          category: $('.material-category, .category').text().trim(),
          readCount: this.parseNumber($('.material-stats .read-count, .read-count').text()),
          likeCount: this.parseNumber($('.material-stats .like-count, .like-count').text()),
          commentCount: this.parseNumber($('.material-stats .comment-count, .comment-count').text()),
          content: $('.common-detail-article, .common-detail').html() || '',
          contentText: $('.common-detail-article, .common-detail').text().trim(),
          author: $('.material-author .name, .author .name').text().trim(),
          publishTime: $('.material-time, .time').text().trim(),
          wordCount: this.parseNumber($('.material-stats .word-count, .word-count').text()),
          crawlTime: new Date().toISOString()
        };
      } else {
        throw new Error(`未知的文章类型: ${url}`);
      }

      // 如果标题为空，尝试从 title 标签获取
      if (!article.title) {
        article.title = $('title').text().split('-')[0].trim();
      }

      // 如果内容为空，尝试其他选择器
      if (!article.content) {
        article.content = $('.common-detail-article').html() ||
          $('.common-detail').html() ||
          $('.content-detail').html() ||
          $('.article-content').html() ||
          $('.content').html() || '';
        article.contentText = article.content.replace(/<[^>]+>/g, '').trim();
      }

      // 输出调试信息
      logger.debug('解析文章字段:', {
        type: isPost ? 'post' : 'material',
        hasTitle: !!article.title,
        titleLength: article.title.length,
        hasContent: !!article.content,
        contentLength: article.content.length,
        url: url,
        title: article.title
      });

      // 添加更多选择器试信息
      logger.debug('DOM 选择器结果:', {
        type: isPost ? 'post' : 'material',
        selectors: {
          postContent: $('.post-content').length,
          materialContent: $('.material-content').length,
          content: $('.content').length,
          articleContent: $('.article-content').length,
          contentDetail: $('.content-detail').length,
          // 输出第一个找到的内容容器的 class
          firstContentContainer: $('.post-content, .material-content, .content, .article-content, .content-detail').first().attr('class'),
          // 输出所有可能包含内容的元素的 class
          allContentContainers: $('article, .content, [class*="content"]').map((_, el) => $(el).attr('class')).get()
        }
      });

      if (!article.title || !article.content) {
        logger.error('缺少必填字段:', {
          hasTitle: !!article.title,
          hasContent: !!article.content,
          url,
          title: article.title,
          contentPreview: article.content?.substring(0, 100)
        });
        throw new Error('缺少必填字段');
      }

      await this.mongoService.saveArticle(article);
      logger.info(`保存文章到MongoDB: ${article.title}`);

    } catch (error) {
      logger.error(`爬取详情页${url}失败: ${error}`);
      if (axios.isAxiosError(error)) {
        logger.error('Axios错误详情:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data ? error.response.data.substring(0, 500) : null
        });
      }
      throw error;
    }
  }

  private parseNumber(text: string): number {
    return parseInt(text.replace(/[^0-9]/g, '')) || 0;
  }

  async testMongoDB() {
    try {
      const testArticle = {
        title: "测试文章 " + new Date().toISOString(),
        content: "测试内容",
        url: `http://test.com/${Date.now()}`,
        crawlTime: new Date().toISOString(),
        summary: "测试摘要",
        tags: ["测试"],
        category: "测试分类",
        readCount: 0,
        likeCount: 0,
        commentCount: 0,
        contentText: "测试内容文本",
        author: "测试作者",
        publishTime: new Date().toISOString(),
        wordCount: 100
      };

      await this.mongoService.saveArticle(testArticle);
      logger.info('测试文章保存成功');
    } catch (error) {
      logger.error('测试文章保存失败:', error);
    }
  }

  async stop() {
    await this.crawlQueue.close();
    logger.info('爬虫队列已关闭');
  }
} 