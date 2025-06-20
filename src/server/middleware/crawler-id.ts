// Add this to your middleware folder (e.g., src/server/middleware/social-crawler-bypass.ts)
import { NextFunction, Request, Response } from 'express';

export const socialCrawlerBypass = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const userAgent = request.headers['user-agent'] || '';

  // List of known social media crawler user agents
  const socialCrawlers = [
    'facebookexternalhit',
    'Facebot',
    'Twitterbot',
    'LinkedInBot',
    'Pinterest',
    'Slackbot',
    'WhatsApp',
    'Discordbot',
    'Google-AMPHTML',
  ];

  const isSocialCrawler = socialCrawlers.some((crawler) =>
    userAgent.toLowerCase().includes(crawler.toLowerCase()),
  );

  if (isSocialCrawler) {
    // Store this for later middleware to know it's a crawler
    request.isSocialMediaCrawler = true;
    // Skip auth for social crawlers
    return next();
  }

  return next();
};
