/**
 * Session-Aware TennisStats Scraper
 * 
 * Extends the base scraper with:
 * - Login/session management per account
 * - Cookie persistence (avoids re-login each run)
 * - View counting (detects when 3-view limit is hit)
 * - Graceful fallback when views are exhausted
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { DailyMatch, PlayerStats, H2HData } from './scraper';

export class SessionScraper {
  private browser: Browser | null = null;
  private baseUrl = 'https://tennisstats.com';

  async init(): Promise<void> {
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private async newPage(): Promise<Page> {
    if (!this.browser) throw new Error('Browser not initialized');
    const page = await this.browser.newPage();

    // Randomize user agent to reduce fingerprinting
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    ];
    await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);

    // Block heavy resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'font', 'media', 'stylesheet'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    return page;
  }

  // ─── Login & Session ───────────────────────────────────────────────────

  /**
   * Login to TennisStats with given credentials
   * Returns serialized cookies for reuse
   */
  async login(username: string, password: string): Promise<string> {
    const page = await this.newPage();

    try {
      console.log(`[Session] Logging in as ${username}...`);
      await page.goto(`${this.baseUrl}/login`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Fill login form
      await page.waitForSelector('input[name="username"], input[type="text"]', {
        timeout: 10000,
      });
      
      // Try common form selectors for username field
      const usernameSelector = await page.$('input[name="username"]')
        || await page.$('input[type="text"]')
        || await page.$('input[placeholder*="username" i]')
        || await page.$('input[placeholder*="user" i]');
      
      const passwordSelector = await page.$('input[type="password"]')
        || await page.$('input[name="password"]');

      if (!usernameSelector || !passwordSelector) {
        throw new Error('Could not find login form fields');
      }

      await usernameSelector.type(username, { delay: 50 });
      await passwordSelector.type(password, { delay: 50 });

      // Submit form
      const submitBtn = await page.$('button[type="submit"]')
        || await page.$('input[type="submit"]')
        || await page.$('button:has-text("Login")');

      if (submitBtn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }),
          submitBtn.click(),
        ]);
      } else {
        // Try pressing Enter
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }),
          page.keyboard.press('Enter'),
        ]);
      }

      // Check if login succeeded (should redirect to homepage or dashboard)
      const currentUrl = page.url();
      const pageContent = await page.content();

      if (
        currentUrl.includes('/login') &&
        (pageContent.includes('Invalid') || pageContent.includes('error'))
      ) {
        throw new Error(`Login failed for ${username}`);
      }

      // Extract and serialize cookies
      const cookies = await page.cookies();
      const serialized = JSON.stringify(cookies);

      console.log(`[Session] Login successful for ${username}`);
      return serialized;
    } finally {
      await page.close();
    }
  }

  /**
   * Restore a session from saved cookies
   */
  async restoreSession(page: Page, serializedCookies: string): Promise<boolean> {
    try {
      const cookies = JSON.parse(serializedCookies);
      await page.setCookie(...cookies);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if current session is still valid (logged in)
   */
  async isSessionValid(page: Page): Promise<boolean> {
    // Navigate to a page that would show login state
    await page.goto(this.baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
    const content = await page.content();
    // If we see "Login" link prominently, we're logged out
    // If we see "Logout" or account menu, we're logged in
    return content.includes('Logout') || content.includes('logout') || content.includes('My Account');
  }

  // ─── Gated Page Scraping (uses views) ──────────────────────────────────

  /**
   * Scrape a detailed H2H page (costs 1 view)
   * Returns null if the page shows a paywall/limit message
   */
  async scrapeH2HWithSession(
    h2hPath: string,
    cookies: string
  ): Promise<{ data: H2HData | null; hitLimit: boolean }> {
    const page = await this.newPage();

    try {
      // Restore session
      await this.restoreSession(page, cookies);

      const url = `${this.baseUrl}/h2h/${h2hPath}`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Check if we hit the view limit
      const content = await page.content();
      const hitLimit = this.detectViewLimit(content);

      if (hitLimit) {
        console.log(`[Session] View limit reached on H2H page: ${h2hPath}`);
        return { data: null, hitLimit: true };
      }

      // Scrape the H2H data (same logic as base scraper)
      const data = await this.extractH2HData(page);
      return { data, hitLimit: false };
    } finally {
      await page.close();
    }
  }

  /**
   * Scrape a detailed player page (costs 1 view)
   */
  async scrapePlayerWithSession(
    playerSlug: string,
    cookies: string
  ): Promise<{ data: PlayerStats | null; hitLimit: boolean }> {
    const page = await this.newPage();

    try {
      await this.restoreSession(page, cookies);

      const url = `${this.baseUrl}/players/${playerSlug}`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      const content = await page.content();
      const hitLimit = this.detectViewLimit(content);

      if (hitLimit) {
        console.log(`[Session] View limit reached on player page: ${playerSlug}`);
        return { data: null, hitLimit: true };
      }

      const data = await this.extractPlayerData(page);
      return { data, hitLimit: false };
    } finally {
      await page.close();
    }
  }

  // ─── Free Pages (no view cost) ────────────────────────────────────────

  /**
   * Scrape homepage matches — this is FREE and unlimited
   */
  async scrapeDailyMatchesFree(): Promise<DailyMatch[]> {
    const page = await this.newPage();

    try {
      await page.goto(this.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForSelector('a[href*="/h2h/"]', { timeout: 15000 }).catch(() => {});

      const matches = await page.evaluate(() => {
        // ... same homepage parsing logic as base scraper
        // This page is always free, no login needed
        const results: any[] = [];
        
        // Get all match link containers
        const matchLinks = document.querySelectorAll('a[href*="/h2h/"]');
        
        matchLinks.forEach((link) => {
          const href = (link as HTMLAnchorElement).href;
          const container = link.closest('div') || link;
          const text = container.textContent || '';
          
          // Basic extraction from homepage rows
          results.push({
            h2hUrl: href,
            rawText: text.substring(0, 300), // For debugging
          });
        });
        
        return results;
      });

      return matches;
    } finally {
      await page.close();
    }
  }

  // ─── Detection Helpers ─────────────────────────────────────────────────

  /**
   * Detect if the page is showing a "you've reached your limit" message
   * or paywall/premium gate
   */
  private detectViewLimit(html: string): boolean {
    const limitIndicators = [
      'upgrade to premium',
      'upgrade now',
      'daily limit',
      'limit reached',
      'premium members',
      'subscribe to',
      'unlock all',
      'you have reached',
      'free views',
      'sign up for premium',
    ];

    const lowerHtml = html.toLowerCase();
    
    // Check if most of the page content is gated
    // TennisStats shows a partial page with a premium overlay
    const hasLimitMessage = limitIndicators.some((indicator) =>
      lowerHtml.includes(indicator)
    );

    // Also check if the stats tables are actually populated
    // If they're empty/hidden, the view was blocked
    const hasStatsData =
      lowerHtml.includes('win percentage') &&
      lowerHtml.includes('aces') &&
      !lowerHtml.includes('upgrade to see');

    return hasLimitMessage && !hasStatsData;
  }

  // ─── Data Extraction (from page evaluate) ──────────────────────────────

  private async extractH2HData(page: Page): Promise<H2HData | null> {
    return page.evaluate(() => {
      const pageText = document.body.textContent || '';
      const h1 = document.querySelector('h1')?.textContent || '';
      const vsMatch = h1.match(/(.+?)\s+vs\s+(.+?)\s+Head/i);
      if (!vsMatch) return null;

      const player1 = vsMatch[1].trim();
      const player2 = vsMatch[2].trim();

      const h2hMatch = pageText.match(/H2H Record\s*(\d+)\s*-\s*(\d+)/i);
      const setsMatch = pageText.match(/Sets Won\s*(\d+)\s*-\s*(\d+)/i);

      return {
        player1,
        player2,
        h2hRecord: {
          player1Wins: h2hMatch ? parseInt(h2hMatch[1]) : 0,
          player2Wins: h2hMatch ? parseInt(h2hMatch[2]) : 0,
        },
        setsWon: {
          player1: setsMatch ? parseInt(setsMatch[1]) : 0,
          player2: setsMatch ? parseInt(setsMatch[2]) : 0,
        },
        matchHistory: [],
        comparison: [],
      };
    });
  }

  private async extractPlayerData(page: Page): Promise<PlayerStats | null> {
    return page.evaluate(() => {
      const pageText = document.body.textContent || '';
      const name = document.querySelector('h1')?.textContent?.replace('Stats', '').trim() || '';
      if (!name) return null;

      const rankMatch = pageText.match(/(?:ATP|WTA) Rank\s*(\d+)/i);
      const eloMatch = pageText.match(/Points?\s*([\d,]+)/i);
      const recordMatch = pageText.match(/(\d+)\s*-\s*(\d+)/);
      const ageMatch = pageText.match(/Age\s*(\d+)/i);
      const heightMatch = pageText.match(/([\d.]+)m/);
      const weightMatch = pageText.match(/(\d+)kg/);
      const handMatch = pageText.match(/(Right|Left)-handed/i);
      const trailing12Match = pageText.match(/Trailing 12 Months\s*(\d+\.?\d*)%/i);
      const hardMatch = pageText.match(/Hard\s*(\d+\.?\d*)%/);
      const clayMatch = pageText.match(/Clay\s*(\d+\.?\d*)%/);
      const grassMatch = pageText.match(/Grass\s*(\d+\.?\d*)%/);
      const acesMatch = pageText.match(/Aces Per Match\s*([\d.]+)/i);
      const formMatch = pageText.match(/(\d+)\s*(Unplayable|Very Good|Good|Average|Poor)\s*Form/i);

      return {
        name,
        country: '',
        ranking: rankMatch ? parseInt(rankMatch[1]) : 0,
        eloScore: eloMatch ? parseInt(eloMatch[1].replace(',', '')) : 0,
        age: ageMatch ? parseInt(ageMatch[1]) : 0,
        height: heightMatch ? `${heightMatch[1]}m` : '',
        weight: weightMatch ? `${weightMatch[1]}kg` : '',
        hand: handMatch ? handMatch[1] : '',
        formScore: formMatch ? parseInt(formMatch[1]) : 0,
        careerWins: recordMatch ? parseInt(recordMatch[1]) : 0,
        careerLosses: recordMatch ? parseInt(recordMatch[2]) : 0,
        careerWinPct: 0,
        currentYearWinPct: 0,
        trailing12MonthsWinPct: trailing12Match ? parseFloat(trailing12Match[1]) : 0,
        surfaceWinPct: {
          hard: hardMatch ? parseFloat(hardMatch[1]) : 0,
          clay: clayMatch ? parseFloat(clayMatch[1]) : 0,
          grass: grassMatch ? parseFloat(grassMatch[1]) : 0,
        },
        acesPerMatch: acesMatch ? parseFloat(acesMatch[1]) : 0,
        serveSpeed: null,
        careerPrizeMoney: '',
        titles: 0,
        grandSlams: 0,
        straightSetsWinPct: 0,
        comebackWinPct: 0,
        set1WinPct: 0,
        set2WinPct: 0,
        set3WinPct: 0,
        avgTotalGames3Sets: null,
        avgTotalGames5Sets: null,
      };
    });
  }
}

export default SessionScraper;
