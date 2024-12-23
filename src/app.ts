import express from 'express';
import { CrawlerService } from './services/crawler';
import { logger } from './utils/logger';

const app = express();
const crawler = new CrawlerService();

app.get('/api/crawler/start', async (req, res) => {
  try {
    await crawler.start();
    res.json({ status: 'success', message: 'Crawler started' });
  } catch (error) {
    logger.error(`Error starting crawler: ${error}`);
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

app.get('/api/test/mongodb', async (req, res) => {
  try {
    await crawler.testMongoDB();
    res.json({ status: 'success' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
}); 