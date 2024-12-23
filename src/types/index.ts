// 定义文章数据接口
export interface Article {
  title: string;
  url: string;
  summary: string;
  tags: string[];
  category: string;
  readCount: number;
  likeCount: number;
  commentCount: number;
  content?: string;
  contentText?: string;
  author?: string;
  publishTime?: string;
  wordCount?: number;
  crawlTime: string;
}

// 爬虫配置接口
export interface CrawlerConfig {
  delay: number;
  concurrent: number;
  timeout: number;
  retryTimes: number;
  userAgent: string;
} 