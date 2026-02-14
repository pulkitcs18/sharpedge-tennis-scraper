/**
 * TennisStats.com Scraper — Premium Cookie Mode
 * 
 * Scrapes homepage (free) + detail pages (with Premium cookies)
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DailyMatch {
  tournament: string;
  country: string;
  gender: 'Men' | 'Women';
  category: 'Singles' | 'Doubles';
  round: string;
  surface: 'Hard' | 'Clay' | 'Grass';
  player1: {
    name: string;
    ranking: number | null;
    formScore: number;
    odds: number | null;
  };
  player2: {
    name: string;
    ranking: number | null;
    formScore: number;
    odds: number | null;
  };
  scheduledTime: string;
  status: 'upcoming' | 'live' | 'finished';
  h2hUrl: string;
  score?: string;
}

export interface PlayerStats {
  name: string;
  slug: string;
  country: string;
  ranking: number;
  eloScore: number;
  age: number;
  height: string;
  weight: string;
  hand: string;
  formScore: number;
  careerWins: number;
  careerLosses: number;
  careerWinPct: number;
  currentYearWinPct: number;
  trailing12mWinPct: number;
  hardWinPct: number;
  clayWinPct: number;
  grassWinPct: number;
  acesPerMatch: number;
  straightSetsWinPct: number;
  comebackWinPct: number;
}

export interface H2HData {
  h2hKey: string;
  player1: string;
  player2: string;
  h2hRecord: { player1Wins: number; player2Wins: number };
  setsWon: { player1: number; player2: number };
  matchHistory: any[];
  comparisonStats: any[];
  player1Stats: PlayerStats | null;
  player2Stats: PlayerStats | null;
}

// ─── Scraper Class ───────────────────────────────────────────────────────────

export class TennisStatsScraper {
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
    console.log('[TennisStats] Browser initialized');
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
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );
    return page;
  }

  private async newPageWithCookies(cookiesJson: string): Promise<Page> {
    const page = await this.newPage();
    try {
      const cookies = JSON.parse(cookiesJson);
      await page.setCookie(...cookies);
    } catch (err) {
      console.warn('[TennisStats] Failed to set cookies:', err);
    }
    return page;
  }

  // ─── Daily Matches (Homepage, FREE) ─────────────────────────────────────

  async scrapeDailyMatches(date?: string, cookiesJson?: string): Promise<DailyMatch[]> {
    const page = cookiesJson ? await this.newPageWithCookies(cookiesJson) : await this.newPage();
    const url = date ? `${this.baseUrl}/${date}` : this.baseUrl;
    
    console.log(`[TennisStats] Scraping daily matches from ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    await page.waitForSelector('a[href*="/h2h/"]', { timeout: 20000 }).catch(() => {
      console.warn('[TennisStats] No match links found or timeout');
    });

    await new Promise(r => setTimeout(r, 3000));

    const matches = await page.evaluate(() => {
      const results: any[] = [];
      const matchLinks = document.querySelectorAll('a[href*="/h2h/"]');

      matchLinks.forEach((link: any) => {
        const href = link.getAttribute('href') || '';
        const rawText = (link.textContent || '').replace(/\s+/g, ' ').trim();

        if (!rawText || !href) return;

        const rankingPattern = /\(([^)]+)\)/g;
        const rankings: any[] = [];
        let m;
        while ((m = rankingPattern.exec(rawText)) !== null) {
          rankings.push({ match: m[0], value: m[1], index: m.index });
        }

        if (rankings.length < 2) return;

        const beforeRank1 = rawText.substring(0, rankings[0].index).trim();
        const betweenRanks = rawText.substring(
          rankings[0].index + rankings[0].match.length,
          rankings[1].index
        ).trim();
        const afterRank2 = rawText.substring(
          rankings[1].index + rankings[1].match.length
        ).trim();

        const p1Match = beforeRank1.match(/^(\d+)\s+(.+)$/);
        if (!p1Match) return;
        const form1 = parseInt(p1Match[1]);
        const name1 = p1Match[2].trim();

        const isFinished = betweenRanks.includes('Fin.');
        const isLive = betweenRanks.includes('Serving') || betweenRanks.includes('•');
        let status: string = 'upcoming';
        if (isFinished) status = 'finished';
        else if (isLive) status = 'live';

        const timeMatch = betweenRanks.match(/\d{1,2}:\d{2}\s*[ap]m/i);
        const scheduledTime = timeMatch ? timeMatch[0] : '';

        const name2Match = betweenRanks.match(/(\d+)\s+([A-Z][a-zA-Z][\w\s.'-]+)$/);
        const form2 = name2Match ? parseInt(name2Match[1]) : 0;
        const name2 = name2Match ? name2Match[2].trim() : '';

        const odds1Match = betweenRanks.match(/^[\s]*(\d+\.\d{2})/);
        const odds1 = odds1Match ? parseFloat(odds1Match[1]) : null;

        const odds2Match = afterRank2.match(/(\d+\.\d{2})/);
        const odds2 = odds2Match ? parseFloat(odds2Match[1]) : null;

        let rank1: number | null = null;
        const rank1Match = rankings[0].value.match(/^(\d+)/);
        if (rank1Match) rank1 = parseInt(rank1Match[1]);

        let rank2: number | null = null;
        const rank2Match = rankings[1].value.match(/^(\d+)/);
        if (rank2Match) rank2 = parseInt(rank2Match[1]);

        if (!name1 || !name2) return;

        results.push({
          player1: { name: name1, ranking: rank1, formScore: form1, odds: odds1 },
          player2: { name: name2, ranking: rank2, formScore: form2, odds: odds2 },
          scheduledTime,
          status,
          h2hUrl: href.startsWith('http') ? href : 'https://tennisstats.com' + href,
        });
      });

      // Extract tournament context
      const sections = document.querySelectorAll('h2, a[href*="/h2h/"]');
      let currentTournament = '';
      let currentCountry = '';
      let currentGender: string = 'Men';
      let currentCategory: string = 'Singles';
      let currentSurface: string = 'Hard';
      let currentRound: string = 'Main';

      const tournamentMap = new Map<string, any>();

      sections.forEach((el: any) => {
        if (el.tagName === 'H2') {
          const text = (el.textContent || '').trim();
          const parts = text.match(/^(.+?)\s*-\s*(.+)$/);
          if (parts) {
            currentTournament = parts[1].trim();
            currentCountry = parts[2].trim();
          }
          const parent = el.closest('div') || el.parentElement;
          const parentText = parent ? parent.textContent || '' : '';
          
          if (parentText.includes('Women')) currentGender = 'Women';
          else currentGender = 'Men';
          
          if (parentText.includes('Doubles')) currentCategory = 'Doubles';
          else currentCategory = 'Singles';
          
          if (parentText.includes('Clay')) currentSurface = 'Clay';
          else if (parentText.includes('Grass')) currentSurface = 'Grass';
          else currentSurface = 'Hard';

          if (parentText.includes('Qualification')) currentRound = 'Qualification';
          else currentRound = 'Main';
        } else {
          const href = el.getAttribute('href') || '';
          if (href.includes('/h2h/')) {
            const fullUrl = href.startsWith('http') ? href : 'https://tennisstats.com' + href;
            tournamentMap.set(fullUrl, {
              tournament: currentTournament,
              country: currentCountry,
              gender: currentGender,
              category: currentCategory,
              surface: currentSurface,
              round: currentRound,
            });
          }
        }
      });

      return results.map((r: any) => {
        const info = tournamentMap.get(r.h2hUrl) || {};
        return { ...r, ...info };
      });
    });

    await page.close();
    console.log(`[TennisStats] Found ${matches.length} matches`);
    return matches as DailyMatch[];
  }

  // ─── H2H Detail Page (Premium, needs cookies) ──────────────────────────

  async scrapeH2HWithCookies(h2hUrl: string, cookiesJson: string): Promise<H2HData | null> {
    const page = await this.newPageWithCookies(cookiesJson);

    try {
      await page.goto(h2hUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      // Check if Cloudflare blocked us
      const pageText = await page.evaluate(() => document.body.textContent || '');
      if (pageText.includes('Performing security verification')) {
        console.warn('[TennisStats] Cloudflare challenge on H2H page');
        await page.close();
        return null;
      }

      // Check if we're actually on the H2H page
      const hasH2H = pageText.toLowerCase().includes('head to head') || 
                     pageText.toLowerCase().includes('h2h') ||
                     pageText.toLowerCase().includes(' vs ');
      
      if (!hasH2H) {
        console.warn('[TennisStats] Not on H2H page — cookies may be expired');
        await page.close();
        return null;
      }

      const data = await page.evaluate((url: string) => {
        const text = (document.body.textContent || '').replace(/\s+/g, ' ');

        // Extract player names from h1
        const h1 = document.querySelector('h1')?.textContent || '';
        const vsMatch = h1.match(/(.+?)\s+vs\.?\s+(.+?)(?:\s+Head|\s+H2H|\s*$)/i);
        if (!vsMatch) return null;

        const player1 = vsMatch[1].trim();
        const player2 = vsMatch[2].trim();

        // H2H key from URL
        const urlMatch = url.match(/\/h2h\/(.+?)$/);
        const h2hKey = urlMatch ? urlMatch[1] : player1 + '-vs-' + player2;

        // Helper to extract numbers
        const grab = (pattern: RegExp) => {
          const m = text.match(pattern);
          return m ? m[1] : null;
        };
        const grabNum = (pattern: RegExp) => {
          const v = grab(pattern);
          return v ? parseFloat(v.replace(',', '')) : 0;
        };

        // H2H record — look for patterns like "3 - 5" near "H2H" or "Head to Head"
        let p1Wins = 0, p2Wins = 0;
        const h2hRecordMatch = text.match(/(?:H2H|Head to Head)[^0-9]*(\d+)\s*-\s*(\d+)/i);
        if (h2hRecordMatch) {
          p1Wins = parseInt(h2hRecordMatch[1]);
          p2Wins = parseInt(h2hRecordMatch[2]);
        }

        // Sets won
        let p1Sets = 0, p2Sets = 0;
        const setsMatch = text.match(/Sets?\s+Won[^0-9]*(\d+)\s*-\s*(\d+)/i);
        if (setsMatch) {
          p1Sets = parseInt(setsMatch[1]);
          p2Sets = parseInt(setsMatch[2]);
        }

        // Match history — try to find table rows with dates
        const matchHistory: any[] = [];
        const historyRows = document.querySelectorAll('table tr, .match-history-row, [class*="match"]');
        historyRows.forEach((row: any) => {
          const rowText = (row.textContent || '').replace(/\s+/g, ' ').trim();
          const dateMatch = rowText.match(/(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/);
          if (dateMatch) {
            const scoreMatch = rowText.match(/(\d+)\s*-\s*(\d+)/);
            matchHistory.push({
              date: dateMatch[1],
              text: rowText.substring(0, 100),
              score: scoreMatch ? scoreMatch[0] : '',
            });
          }
        });

        // Comparison stats — look for stat rows
        const comparisonStats: any[] = [];
        const statLabels = [
          'Aces', 'Double Faults', 'Win %', 'Straight Sets', 
          'Hard', 'Clay', 'Grass', 'Serve', 'Return',
          'Break Points', 'Tie Breaks'
        ];
        
        statLabels.forEach(label => {
          const pattern = new RegExp(label + '[^0-9]*([\\d.]+%?)[^0-9]*([\\d.]+%?)', 'i');
          const m = text.match(pattern);
          if (m) {
            comparisonStats.push({
              metric: label,
              player1Value: m[1],
              player2Value: m[2],
            });
          }
        });

        // Player stats extraction
        const extractPlayerStats = (name: string, isPlayer1: boolean) => {
          // Look for stat blocks — these are usually in two columns on the H2H page
          const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          
          return {
            name,
            slug,
            country: '',
            ranking: grabNum(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^0-9]*(?:Rank|#)\\s*(\\d+)', 'i')),
            eloScore: 0,
            age: 0,
            height: '',
            weight: '',
            hand: '',
            formScore: 0,
            careerWins: 0,
            careerLosses: 0,
            careerWinPct: 0,
            currentYearWinPct: 0,
            trailing12mWinPct: 0,
            hardWinPct: 0,
            clayWinPct: 0,
            grassWinPct: 0,
            acesPerMatch: 0,
            straightSetsWinPct: 0,
            comebackWinPct: 0,
          };
        };

        return {
          h2hKey,
          player1,
          player2,
          h2hRecord: { player1Wins: p1Wins, player2Wins: p2Wins },
          setsWon: { player1: p1Sets, player2: p2Sets },
          matchHistory,
          comparisonStats,
          player1Stats: extractPlayerStats(player1, true),
          player2Stats: extractPlayerStats(player2, false),
        };
      }, h2hUrl);

      await page.close();
      return data;

    } catch (err: any) {
      await page.close();
      throw err;
    }
  }
}

export default TennisStatsScraper;
