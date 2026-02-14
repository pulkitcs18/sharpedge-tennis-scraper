/**
 * Session-Aware TennisStats Scraper
 * 
 * Handles login, cookie persistence, and view tracking per account
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

    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    ];
    await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);

    return page;
  }

  // ─── Login & Session ───────────────────────────────────────────────────

  async login(username: string, password: string): Promise<string> {
    const page = await this.newPage();

    try {
      console.log(`[Session] Logging in as ${username}...`);
      await page.goto(`${this.baseUrl}/login`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Wait for page to fully render
      await new Promise(r => setTimeout(r, 3000));

      // Debug: log what input fields exist on the page
      const inputInfo = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        return inputs.map(i => ({
          type: i.type,
          name: i.name,
          id: i.id,
          placeholder: i.placeholder,
          className: i.className.substring(0, 50),
        }));
      });
      console.log(`[Session] Found ${inputInfo.length} input fields:`, JSON.stringify(inputInfo));

      // Also check for iframes (some sites put login in an iframe)
      const iframeCount = await page.evaluate(() => document.querySelectorAll('iframe').length);
      if (iframeCount > 0) {
        console.log(`[Session] Found ${iframeCount} iframes on login page`);
      }

      // Strategy: try multiple selector approaches
      const usernameSelectors = [
        'input[name="username"]',
        'input[name="login"]',
        'input[name="user"]',
        'input[name="email"]',
        'input[type="email"]',
        'input[type="text"]:not([name=""])',
        'input[type="text"]',
        'input[placeholder*="user" i]',
        'input[placeholder*="email" i]',
        'input[placeholder*="login" i]',
        'input[placeholder*="name" i]',
        'input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="checkbox"])',
      ];

      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[name="pass"]',
      ];

      let usernameField = null;
      let passwordField = null;

      // Find username field
      for (const selector of usernameSelectors) {
        try {
          usernameField = await page.$(selector);
          if (usernameField) {
            console.log(`[Session] Found username field with: ${selector}`);
            break;
          }
        } catch {}
      }

      // Find password field
      for (const selector of passwordSelectors) {
        try {
          passwordField = await page.$(selector);
          if (passwordField) {
            console.log(`[Session] Found password field with: ${selector}`);
            break;
          }
        } catch {}
      }

      if (!usernameField || !passwordField) {
        // Last resort: get all visible inputs and use first two
        const visibleInputs = await page.$$('input:not([type="hidden"]):not([type="submit"]):not([type="checkbox"])');
        console.log(`[Session] Fallback: found ${visibleInputs.length} visible inputs`);
        
        if (visibleInputs.length >= 2) {
          usernameField = visibleInputs[0];
          passwordField = visibleInputs[1];
          console.log('[Session] Using first two visible inputs as username/password');
        } else {
          // Log the page HTML for debugging
          const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 2000));
          console.log('[Session] Page HTML preview:', bodyHTML);
          throw new Error('Could not find login form fields');
        }
      }

      // Clear and type
      await usernameField.click({ clickCount: 3 }); // Select all
      await usernameField.type(username, { delay: 50 });

      await passwordField.click({ clickCount: 3 });
      await passwordField.type(password, { delay: 50 });

      // Try to find and click submit button
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:not([type="button"])',
        'button',
        '.login-btn',
        '.submit-btn',
        'a.btn',
      ];

      let submitted = false;
      for (const selector of submitSelectors) {
        try {
          const btn = await page.$(selector);
          if (btn) {
            const btnText = await page.evaluate((el: any) => el.textContent || '', btn);
            // Only click buttons that look like login/submit
            if (btnText.toLowerCase().match(/log\s*in|sign\s*in|submit|enter|go/i) || selector.includes('submit')) {
              console.log(`[Session] Clicking submit: ${selector} ("${btnText.trim()}")`);
              await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
                btn.click(),
              ]);
              submitted = true;
              break;
            }
          }
        } catch {}
      }

      if (!submitted) {
        // Try pressing Enter
        console.log('[Session] No submit button found, pressing Enter');
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
          page.keyboard.press('Enter'),
        ]);
      }

      await new Promise(r => setTimeout(r, 2000));

      // Check if login succeeded
      const currentUrl = page.url();
      const pageContent = await page.evaluate(() => document.body.textContent || '');
      const hasLogout = pageContent.toLowerCase().includes('logout') || pageContent.toLowerCase().includes('my account');
      const stillOnLogin = currentUrl.includes('/login');

      if (stillOnLogin && !hasLogout) {
        console.log(`[Session] Still on login page. URL: ${currentUrl}`);
        throw new Error(`Login failed for ${username}`);
      }

      const cookies = await page.cookies();
      const serialized = JSON.stringify(cookies);

      console.log(`[Session] Login successful for ${username}`);
      return serialized;
    } finally {
      await page.close();
    }
  }

  // ─── Restore Session ───────────────────────────────────────────────────

  async restoreSession(page: Page, serializedCookies: string): Promise<boolean> {
    try {
      const cookies = JSON.parse(serializedCookies);
      await page.setCookie(...cookies);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Gated Page Scraping ──────────────────────────────────────────────

  async scrapeH2HWithSession(
    h2hPath: string,
    cookies: string
  ): Promise<{ data: H2HData | null; hitLimit: boolean }> {
    const page = await this.newPage();

    try {
      await this.restoreSession(page, cookies);

      const url = `${this.baseUrl}/h2h/${h2hPath}`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      const content = await page.evaluate(() => document.body.textContent || '');
      const hitLimit = this.detectViewLimit(content);

      if (hitLimit) {
        console.log(`[Session] View limit reached on H2H page: ${h2hPath}`);
        return { data: null, hitLimit: true };
      }

      const data = await this.extractH2HData(page);
      return { data, hitLimit: false };
    } finally {
      await page.close();
    }
  }

  async scrapePlayerWithSession(
    playerSlug: string,
    cookies: string
  ): Promise<{ data: PlayerStats | null; hitLimit: boolean }> {
    const page = await this.newPage();

    try {
      await this.restoreSession(page, cookies);

      const url = `${this.baseUrl}/players/${playerSlug}`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      const content = await page.evaluate(() => document.body.textContent || '');
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

  // ─── Detection ─────────────────────────────────────────────────────────

  private detectViewLimit(text: string): boolean {
    const lower = text.toLowerCase();
    const limitIndicators = [
      'upgrade to premium',
      'upgrade now',
      'daily limit',
      'limit reached',
      'premium members',
      'subscribe to',
      'you have reached',
      'free views',
    ];

    return limitIndicators.some((indicator) => lower.includes(indicator))
      && !lower.includes('win percentage');
  }

  // ─── Data Extraction ──────────────────────────────────────────────────

  private async extractH2HData(page: Page): Promise<H2HData | null> {
    return page.evaluate(() => {
      const pageText = (document.body.textContent || '').replace(/\s+/g, ' ');
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
      const pageText = (document.body.textContent || '').replace(/\s+/g, ' ');
      const name = (document.querySelector('h1')?.textContent || '').replace('Stats', '').trim();
      if (!name) return null;

      const grab = (pattern: RegExp) => {
        const m = pageText.match(pattern);
        return m ? m[1] : null;
      };
      const grabNum = (pattern: RegExp) => {
        const v = grab(pattern);
        return v ? parseFloat(v.replace(',', '')) : 0;
      };

      return {
        name,
        country: '',
        ranking: grabNum(/(?:ATP|WTA) Rank\s*(\d+)/i),
        eloScore: grabNum(/Points?\s*([\d,]+)/i),
        age: grabNum(/Age\s*(\d+)/i),
        height: grab(/([\d.]+)m/) ? grab(/([\d.]+)m/) + 'm' : '',
        weight: grab(/(\d+)kg/) ? grab(/(\d+)kg/) + 'kg' : '',
        hand: grab(/(Right|Left)-handed/i) || '',
        formScore: grabNum(/(\d+)\s*(?:Unplayable|Very Good|Good|Average|Poor)\s*Form/i),
        careerWins: grabNum(/(\d+)\s*wins to/i),
        careerLosses: grabNum(/wins to\s*(\d+)\s*losses/i),
        careerWinPct: grabNum(/Career Total\s*(\d+\.?\d*)%/i),
        currentYearWinPct: grabNum(/2026.*?(\d+\.?\d*)%/),
        trailing12MonthsWinPct: grabNum(/Trailing 12 Months\s*(\d+\.?\d*)%/i),
        surfaceWinPct: {
          hard: grabNum(/Hard\s*(\d+\.?\d*)%/),
          clay: grabNum(/Clay\s*(\d+\.?\d*)%/),
          grass: grabNum(/Grass\s*(\d+\.?\d*)%/),
        },
        acesPerMatch: grabNum(/Aces Per Match\s*([\d.]+)/i),
        serveSpeed: grabNum(/Serve Speed.*?(\d+\.?\d*)km/i) || null,
        careerPrizeMoney: grab(/\$([\d,]+)/) ? '$' + grab(/\$([\d,]+)/) : '',
        titles: grabNum(/(\d+)\s*Titles/i),
        grandSlams: grabNum(/(\d+)\s*Grand Slams/i),
        straightSetsWinPct: grabNum(/Wins in Straight Sets\s*(\d+\.?\d*)%/i),
        comebackWinPct: grabNum(/Wins From Behind\s*(\d+\.?\d*)%/i),
        set1WinPct: grabNum(/Set 1 Win\s*(\d+\.?\d*)%/i),
        set2WinPct: grabNum(/Set 2 Win\s*(\d+\.?\d*)%/i),
        set3WinPct: grabNum(/Set 3 Win\s*(\d+\.?\d*)%/i),
        avgTotalGames3Sets: grabNum(/Average Total Games \(3 Set.*?\)\s*([\d.]+)/i) || null,
        avgTotalGames5Sets: grabNum(/Average Total Games \(5 Set.*?\)\s*([\d.]+)/i) || null,
      };
    });
  }
}

export default SessionScraper;
