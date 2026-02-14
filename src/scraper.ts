/**
 * TennisStats.com Scraper for SharpEdge Tennis Predictions
 * 
 * Scrapes player stats, H2H data, daily matches, odds, and form data
 * Designed to run on Railway alongside existing Action Network scraper
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
  trailing12MonthsWinPct: number;
  surfaceWinPct: {
    hard: number;
    clay: number;
    grass: number;
  };
  acesPerMatch: number;
  serveSpeed: number | null;
  careerPrizeMoney: string;
  titles: number;
  grandSlams: number;
  straightSetsWinPct: number;
  comebackWinPct: number;
  set1WinPct: number;
  set2WinPct: number;
  set3WinPct: number;
  avgTotalGames3Sets: number | null;
  avgTotalGames5Sets: number | null;
}

export interface H2HData {
  player1: string;
  player2: string;
  h2hRecord: { player1Wins: number; player2Wins: number };
  setsWon: { player1: number; player2: number };
  matchHistory: {
    date: string;
    tournament: string;
    surface: string;
    player1Sets: number;
    player2Sets: number;
    winner: string;
  }[];
  comparison: {
    metric: string;
    player1Value: string;
    player2Value: string;
  }[];
}

export interface RankingEntry {
  rank: number;
  name: string;
  eloScore: number;
  playerUrl: string;
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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );
    return page;
  }

  // ─── Daily Matches ──────────────────────────────────────────────────────

  async scrapeDailyMatches(date?: string): Promise<DailyMatch[]> {
    const page = await this.newPage();
    const url = date ? `${this.baseUrl}/${date}` : this.baseUrl;

    console.log(`[TennisStats] Scraping daily matches from ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for match links to appear
    await page.waitForSelector('a[href*="/h2h/"]', { timeout: 20000 }).catch(() => {
      console.warn('[TennisStats] No match links found or timeout');
    });

    // Extra wait for dynamic content
    await new Promise(r => setTimeout(r, 3000));

    const matches = await page.evaluate(() => {
      const results: any[] = [];

      // Get all match links on the page
      const matchLinks = document.querySelectorAll('a[href*="/h2h/"]');

      matchLinks.forEach((link: any) => {
        const href = link.getAttribute('href') || '';
        // Normalize the text: collapse whitespace and newlines
        const rawText = (link.textContent || '').replace(/\s+/g, ' ').trim();

        if (!rawText || !href) return;

        // ──────────────────────────────────────────────────────────
        // Match text patterns from tennisstats.com:
        //
        // Upcoming with odds:
        //   "86 Alex De Minaur (8) 1.36 2:00pm 67 Ugo Humbert (36) 3.20"
        //
        // Upcoming without odds:
        //   "86 Taylor Fritz (7) 4:00pm 75 Marin Cilic (61)"
        //
        // Finished:
        //   "80 Taylor Fritz (7) 1.50 2 Fin. 71 Brandon Nakashima (29) 2.63 0"
        //
        // Live:
        //   "71 Ioannis Xilas (388) 1.44 1 5 15 33 Eric Vanshelboim (542) 2.63 0 3 40 • Serving"
        //
        // Doubles:
        //   "73 Arevalo - Pavic (6 / 6) 1.18 12:00pm 60 Ho - Jebens (74 / 73) 4.50"
        // ──────────────────────────────────────────────────────────

        // Pattern: form1 Name1 (rank1) [odds1] time/status form2 Name2 (rank2) [odds2] [score]
        // Regex approach: extract chunks around the parenthesized rankings

        // Find all (number) patterns for rankings
        const rankingPattern = /\(([^)]+)\)/g;
        const rankings: any[] = [];
        let m;
        while ((m = rankingPattern.exec(rawText)) !== null) {
          rankings.push({ match: m[0], value: m[1], index: m.index });
        }

        if (rankings.length < 2) return; // Need at least 2 rankings (2 players)

        // Split text at the two ranking markers
        const beforeRank1 = rawText.substring(0, rankings[0].index).trim();
        const betweenRanks = rawText.substring(
          rankings[0].index + rankings[0].match.length,
          rankings[1].index
        ).trim();
        const afterRank2 = rawText.substring(
          rankings[1].index + rankings[1].match.length
        ).trim();

        // Parse Player 1: "86 Alex De Minaur" → form=86, name="Alex De Minaur"
        const p1Match = beforeRank1.match(/^(\d+)\s+(.+)$/);
        if (!p1Match) return;
        const form1 = parseInt(p1Match[1]);
        const name1 = p1Match[2].trim();
        const rank1Text = rankings[0].value;

        // Parse middle section: "[odds1] time/status form2 Name2"
        // Could be: "1.36 2:00pm 67 Ugo Humbert"
        // Or: "4:00pm 75 Marin Cilic"
        // Or: "1.50 2 Fin. 71 Brandon Nakashima"

        const middleParts = betweenRanks.split(/\s+/);

        let odds1: number | null = null;
        let scheduledTime = '';
        let status: 'upcoming' | 'live' | 'finished' = 'upcoming';
        let form2 = 0;
        let name2 = '';

        // Detect status
        const isFinished = betweenRanks.includes('Fin.');
        const isLive = betweenRanks.includes('Serving') || betweenRanks.includes('•');

        if (isFinished) status = 'finished';
        else if (isLive) status = 'live';

        // Find the time pattern (e.g., "2:00pm", "10:00am")
        const timeMatch = betweenRanks.match(/\d{1,2}:\d{2}\s*[ap]m/i);
        if (timeMatch) {
          scheduledTime = timeMatch[0];
        }

        // Try to find form2 + name2 in the middle section
        // Look for the pattern: number followed by text (player name)
        // Working backwards from the second ranking
        const beforeName2 = betweenRanks;
        const name2Match = beforeName2.match(/(\d+)\s+([A-Z][a-zA-Z][\w\s.'-]+)$/);
        if (name2Match) {
          form2 = parseInt(name2Match[1]);
          name2 = name2Match[2].trim();
        }

        // Try to extract odds1 (first decimal number in the middle)
        const odds1Match = betweenRanks.match(/^[\s]*(\d+\.\d{2})/);
        if (odds1Match) {
          odds1 = parseFloat(odds1Match[1]);
        }

        // Parse after rank2: "[odds2] [score]"
        let odds2: number | null = null;
        const odds2Match = afterRank2.match(/(\d+\.\d{2})/);
        if (odds2Match) {
          odds2 = parseFloat(odds2Match[1]);
        }

        // Parse ranking numbers (handle doubles like "6 / 6")
        let rank1: number | null = null;
        const rank1Match = rank1Text.match(/^(\d+)/);
        if (rank1Match) rank1 = parseInt(rank1Match[1]);

        let rank2: number | null = null;
        const rank2Match = rankings[1].value.match(/^(\d+)/);
        if (rank2Match) rank2 = parseInt(rank2Match[1]);

        if (!name1 || !name2) return;

        results.push({
          player1: {
            name: name1,
            ranking: rank1,
            formScore: form1,
            odds: odds1,
          },
          player2: {
            name: name2,
            ranking: rank2,
            formScore: form2,
            odds: odds2,
          },
          scheduledTime,
          status,
          h2hUrl: href.startsWith('http') ? href : 'https://tennisstats.com' + href,
        });
      });

      // ── Now extract tournament context for each match ──
      // Walk through the page and map sections to their tournament headers
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

          // Look for nearby text that indicates gender/category/surface
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

      // Merge tournament info into results
      return results.map((r: any) => {
        const info = tournamentMap.get(r.h2hUrl) || {};
        return {
          ...r,
          tournament: info.tournament || '',
          country: info.country || '',
          gender: info.gender || 'Men',
          category: info.category || 'Singles',
          surface: info.surface || 'Hard',
          round: info.round || 'Main',
        };
      });
    });

    await page.close();
    console.log(`[TennisStats] Found ${matches.length} matches`);
    return matches as DailyMatch[];
  }

  // ─── Player Stats ──────────────────────────────────────────────────────

  async scrapePlayerStats(playerSlug: string): Promise<PlayerStats | null> {
    const page = await this.newPage();
    const url = `${this.baseUrl}/players/${playerSlug}`;

    console.log(`[TennisStats] Scraping player: ${playerSlug}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const stats = await page.evaluate(() => {
      const pageText = (document.body.textContent || '').replace(/\s+/g, ' ');

      const name = (document.querySelector('h1')?.textContent || '').replace('Stats', '').trim();
      if (!name) return null;

      const grab = (pattern: RegExp): string | null => {
        const m = pageText.match(pattern);
        return m ? m[1] : null;
      };

      const grabNum = (pattern: RegExp): number => {
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
        careerWins: grabNum(/(\d+)\s*-\s*\d+/),
        careerLosses: grabNum(/\d+\s*-\s*(\d+)/),
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

    await page.close();
    return stats;
  }

  // ─── Head to Head ──────────────────────────────────────────────────────

  async scrapeH2H(h2hPath: string): Promise<H2HData | null> {
    const page = await this.newPage();
    const url = h2hPath.startsWith('http') ? h2hPath : `${this.baseUrl}/h2h/${h2hPath}`;

    console.log(`[TennisStats] Scraping H2H: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const data = await page.evaluate(() => {
      const pageText = (document.body.textContent || '').replace(/\s+/g, ' ');

      const h1 = document.querySelector('h1')?.textContent || '';
      const vsMatch = h1.match(/(.+?)\s+vs\s+(.+?)\s+Head/i);
      if (!vsMatch) return null;

      const player1 = vsMatch[1].trim();
      const player2 = vsMatch[2].trim();

      const grab = (pattern: RegExp): string | null => {
        const m = pageText.match(pattern);
        return m ? m[1] : null;
      };

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

    await page.close();
    return data;
  }

  // ─── Rankings ──────────────────────────────────────────────────────────

  async scrapeRankings(tour: 'atp' | 'wta'): Promise<RankingEntry[]> {
    const page = await this.newPage();
    const url = `${this.baseUrl}/rankings/${tour}`;

    console.log(`[TennisStats] Scraping ${tour.toUpperCase()} rankings`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const rankings = await page.evaluate(() => {
      const entries: any[] = [];
      const playerLinks = document.querySelectorAll('a[href*="/players/"]');

      playerLinks.forEach((link: any) => {
        const row = link.closest('tr') || link.closest('div');
        if (!row) return;

        const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
        const rankMatch = text.match(/^(\d+)/);
        const eloMatch = text.match(/([\d,]+)\s*$/);
        const name = (link.textContent || '').trim();
        const href = link.getAttribute('href') || '';

        if (name && rankMatch) {
          entries.push({
            rank: parseInt(rankMatch[1]),
            name,
            eloScore: eloMatch ? parseInt(eloMatch[1].replace(',', '')) : 0,
            playerUrl: href,
          });
        }
      });

      return entries;
    });

    await page.close();
    return rankings;
  }

  // ─── Utility ───────────────────────────────────────────────────────────

  extractPlayerSlug(h2hUrl: string): { player1Slug: string; player2Slug: string } | null {
    const match = h2hUrl.match(/\/h2h\/(.+?)-vs-(.+?)-(\d+)$/);
    if (!match) return null;
    return {
      player1Slug: match[1],
      player2Slug: match[2],
    };
  }
}

export default TennisStatsScraper;
