/**
 * TennisStats.com Scraper for SharpEdge Tennis Predictions
 * 
 * Scrapes player stats, H2H data, daily matches, odds, and form data
 * Designed to run on Railway alongside existing Action Network scraper
 * 
 * Data extracted:
 * - Daily matches with odds, form scores, and tournament info
 * - Player profiles (win %, surface stats, aces, serve speed, etc.)
 * - Head-to-head records with detailed stat comparisons
 * - Rankings (ATP/WTA with Elo scores)
 */

import puppeteer, { Browser, Page } from 'puppeteer';

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
  // Detailed stats for prediction model
  straightSetsWinPct: number;
  comebackWinPct: number;
  set1WinPct: number;
  set2WinPct: number;
  set3WinPct: number;
  // Over/under game stats
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
    // Block images/fonts to speed up scraping
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
    return page;
  }

  // ─── Daily Matches ──────────────────────────────────────────────────────

  async scrapeDailyMatches(date?: string): Promise<DailyMatch[]> {
    const page = await this.newPage();
    const url = date ? `${this.baseUrl}/${date}` : this.baseUrl;
    
    console.log(`[TennisStats] Scraping daily matches from ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for match data to load (site uses JS rendering)
    await page.waitForSelector('a[href*="/h2h/"]', { timeout: 15000 }).catch(() => {
      console.warn('[TennisStats] No matches found or page load timeout');
    });

    const matches = await page.evaluate(() => {
      const results: any[] = [];
      
      // Each tournament section has an h2 header
      const tournamentHeaders = document.querySelectorAll('h2');
      
      tournamentHeaders.forEach((header) => {
        const headerText = header.textContent?.trim() || '';
        // Parse tournament info: "Rotterdam ATP - Netherlands"
        const tournamentMatch = headerText.match(/^(.+?)\s*-\s*(.+)$/);
        if (!tournamentMatch) return;
        
        const tournament = tournamentMatch[1].trim();
        const country = tournamentMatch[2].trim();
        
        // Determine gender and category from nearby elements
        const section = header.closest('div') || header.parentElement;
        if (!section) return;
        
        const sectionText = section.textContent || '';
        const gender = sectionText.includes('Women') ? 'Women' : 'Men';
        const category = sectionText.includes('Doubles') ? 'Doubles' : 'Singles';
        const surface = sectionText.includes('Clay') ? 'Clay' 
                      : sectionText.includes('Grass') ? 'Grass' 
                      : 'Hard';

        // Find match links within the section
        const matchLinks = section.querySelectorAll('a[href*="/h2h/"]');
        
        matchLinks.forEach((link) => {
          const href = (link as HTMLAnchorElement).href;
          const matchText = link.textContent?.trim() || '';
          
          // Extract player names, form scores, odds, and times from match row
          const row = link.closest('div') || link;
          const allText = row.textContent || '';
          
          // Try to parse player data from the match entry
          const nameMatches = allText.match(
            /(\d+)\s+(.+?)\s*\((\d+)\)\s*([\d.]+)?\s*([\d:]+\s*[ap]m|Fin\.|Live)\s*(\d+)\s+(.+?)\s*\((\d+)\)\s*([\d.]+)?/i
          );
          
          if (nameMatches) {
            const isFinished = allText.includes('Fin.');
            const isLive = allText.includes('Serving') || allText.includes('Live');
            
            results.push({
              tournament,
              country,
              gender,
              category,
              round: 'Main',
              surface,
              player1: {
                name: nameMatches[2].trim(),
                ranking: parseInt(nameMatches[3]) || null,
                formScore: parseInt(nameMatches[1]) || 0,
                odds: nameMatches[4] ? parseFloat(nameMatches[4]) : null,
              },
              player2: {
                name: nameMatches[7].trim(),
                ranking: parseInt(nameMatches[8]) || null,
                formScore: parseInt(nameMatches[6]) || 0,
                odds: nameMatches[9] ? parseFloat(nameMatches[9]) : null,
              },
              scheduledTime: nameMatches[5]?.trim() || '',
              status: isFinished ? 'finished' : isLive ? 'live' : 'upcoming',
              h2hUrl: href,
            });
          }
        });
      });
      
      return results;
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

    const stats = await page.evaluate(() => {
      const getText = (selector: string): string => {
        const el = document.querySelector(selector);
        return el?.textContent?.trim() || '';
      };

      const pageText = document.body.textContent || '';

      // Parse name from h1
      const name = document.querySelector('h1')?.textContent?.replace('Stats', '').trim() || '';
      if (!name) return null;

      // Parse ranking and elo
      const rankMatch = pageText.match(/ATP Rank\s*(\d+)/i) || pageText.match(/WTA Rank\s*(\d+)/i);
      const eloMatch = pageText.match(/Points?\s*([\d,]+)/i);
      
      // Parse career record
      const recordMatch = pageText.match(/(\d+)\s*-\s*(\d+)/);
      const wins = recordMatch ? parseInt(recordMatch[1]) : 0;
      const losses = recordMatch ? parseInt(recordMatch[2]) : 0;

      // Parse age, height, weight
      const ageMatch = pageText.match(/Age\s*(\d+)/i);
      const heightMatch = pageText.match(/([\d.]+)m/);
      const weightMatch = pageText.match(/(\d+)kg/);
      const handMatch = pageText.match(/(Right|Left)-handed/i);

      // Parse win percentages
      const yearWinMatch = pageText.match(/Win Percentage\s*2026.*?(\d+\.?\d*)%/s);
      const trailing12Match = pageText.match(/Trailing 12 Months\s*(\d+\.?\d*)%/i);
      const careerWinMatch = pageText.match(/Career Total\s*(\d+\.?\d*)%/i);

      // Surface win percentages
      const hardMatch = pageText.match(/Hard\s*(\d+\.?\d*)%/);
      const clayMatch = pageText.match(/Clay\s*(\d+\.?\d*)%/);
      const grassMatch = pageText.match(/Grass\s*(\d+\.?\d*)%/);

      // Aces per match
      const acesMatch = pageText.match(/Aces Per Match\s*([\d.]+)/i);
      
      // Serve speed
      const serveMatch = pageText.match(/Serve Speed.*?(\d+\.?\d*)km\/h/i);

      // Prize money
      const moneyMatch = pageText.match(/\$([\d,]+)/);

      // Titles
      const titlesMatch = pageText.match(/(\d+)\s*Titles/i);
      const slamsMatch = pageText.match(/(\d+)\s*Grand Slams/i);

      // Form score
      const formMatch = pageText.match(/(\d+)\s*(Unplayable|Very Good|Good|Average|Poor)\s*Form/i);

      // Detailed match stats
      const straightSetsMatch = pageText.match(/Wins in Straight Sets\s*(\d+\.?\d*)%/i);
      const comebackMatch = pageText.match(/Wins From Behind\s*(\d+\.?\d*)%/i);
      const set1Match = pageText.match(/Set 1 Win\s*(\d+\.?\d*)%/i);
      const set2Match = pageText.match(/Set 2 Win\s*(\d+\.?\d*)%/i);
      const set3Match = pageText.match(/Set 3 Win\s*(\d+\.?\d*)%/i);

      // Game totals
      const avgGames3Match = pageText.match(/Average Total Games \(3 Set.*?\)\s*([\d.]+)/i);
      const avgGames5Match = pageText.match(/Average Total Games \(5 Set.*?\)\s*([\d.]+)/i);

      return {
        name,
        country: '', // Parsed from flag/subtitle
        ranking: rankMatch ? parseInt(rankMatch[1]) : 0,
        eloScore: eloMatch ? parseInt(eloMatch[1].replace(',', '')) : 0,
        age: ageMatch ? parseInt(ageMatch[1]) : 0,
        height: heightMatch ? `${heightMatch[1]}m` : '',
        weight: weightMatch ? `${weightMatch[1]}kg` : '',
        hand: handMatch ? handMatch[1] : '',
        formScore: formMatch ? parseInt(formMatch[1]) : 0,
        careerWins: wins,
        careerLosses: losses,
        careerWinPct: careerWinMatch ? parseFloat(careerWinMatch[1]) : 0,
        currentYearWinPct: yearWinMatch ? parseFloat(yearWinMatch[1]) : 0,
        trailing12MonthsWinPct: trailing12Match ? parseFloat(trailing12Match[1]) : 0,
        surfaceWinPct: {
          hard: hardMatch ? parseFloat(hardMatch[1]) : 0,
          clay: clayMatch ? parseFloat(clayMatch[1]) : 0,
          grass: grassMatch ? parseFloat(grassMatch[1]) : 0,
        },
        acesPerMatch: acesMatch ? parseFloat(acesMatch[1]) : 0,
        serveSpeed: serveMatch ? parseFloat(serveMatch[1]) : null,
        careerPrizeMoney: moneyMatch ? `$${moneyMatch[1]}` : '',
        titles: titlesMatch ? parseInt(titlesMatch[1]) : 0,
        grandSlams: slamsMatch ? parseInt(slamsMatch[1]) : 0,
        straightSetsWinPct: straightSetsMatch ? parseFloat(straightSetsMatch[1]) : 0,
        comebackWinPct: comebackMatch ? parseFloat(comebackMatch[1]) : 0,
        set1WinPct: set1Match ? parseFloat(set1Match[1]) : 0,
        set2WinPct: set2Match ? parseFloat(set2Match[1]) : 0,
        set3WinPct: set3Match ? parseFloat(set3Match[1]) : 0,
        avgTotalGames3Sets: avgGames3Match ? parseFloat(avgGames3Match[1]) : null,
        avgTotalGames5Sets: avgGames5Match ? parseFloat(avgGames5Match[1]) : null,
      };
    });

    await page.close();
    return stats;
  }

  // ─── Head to Head ──────────────────────────────────────────────────────

  async scrapeH2H(h2hPath: string): Promise<H2HData | null> {
    const page = await this.newPage();
    // h2hPath can be full URL or just the path portion
    const url = h2hPath.startsWith('http') ? h2hPath : `${this.baseUrl}/h2h/${h2hPath}`;
    
    console.log(`[TennisStats] Scraping H2H: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const data = await page.evaluate(() => {
      const pageText = document.body.textContent || '';

      // Get player names from the h1
      const h1 = document.querySelector('h1')?.textContent || '';
      const vsMatch = h1.match(/(.+?)\s+vs\s+(.+?)\s+Head/i);
      if (!vsMatch) return null;

      const player1 = vsMatch[1].trim();
      const player2 = vsMatch[2].trim();

      // H2H record
      const h2hMatch = pageText.match(/H2H Record\s*(\d+)\s*-\s*(\d+)/i);
      const setsMatch = pageText.match(/Sets Won\s*(\d+)\s*-\s*(\d+)/i);

      // Parse match history table
      const matchHistory: any[] = [];
      const rows = document.querySelectorAll('table tr, div[class*="match"]');
      
      // Look for date/tournament/result patterns in the page
      const datePatterns = pageText.match(
        /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s*\d{4})\s+(.+?)\s+(?:Hard|Clay|Grass)\s+.*?(\d+)\s*-\s*(\d+)/gi
      );

      if (datePatterns) {
        datePatterns.forEach((match) => {
          const parts = match.match(
            /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s*\d{4})\s+(.+?)\s+(Hard|Clay|Grass)\s+.*?(\d+)\s*-\s*(\d+)/i
          );
          if (parts) {
            matchHistory.push({
              date: parts[1],
              tournament: parts[2].trim(),
              surface: parts[3],
              player1Sets: parseInt(parts[4]),
              player2Sets: parseInt(parts[5]),
              winner: parseInt(parts[4]) > parseInt(parts[5]) ? player1 : player2,
            });
          }
        });
      }

      // Parse comparison stats table
      const comparison: any[] = [];
      const statRows = document.querySelectorAll('table tr');
      statRows.forEach((row) => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3) {
          comparison.push({
            metric: cells[0]?.textContent?.trim() || '',
            player1Value: cells[1]?.textContent?.trim() || '',
            player2Value: cells[2]?.textContent?.trim() || '',
          });
        }
      });

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
        matchHistory,
        comparison,
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
      
      playerLinks.forEach((link) => {
        const row = link.closest('tr') || link.closest('div');
        if (!row) return;
        
        const text = row.textContent || '';
        const rankMatch = text.match(/^(\d+)/);
        const eloMatch = text.match(/([\d,]+)$/);
        const name = link.textContent?.trim() || '';
        const href = (link as HTMLAnchorElement).getAttribute('href') || '';
        
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

  // ─── Utility: Extract player slug from match URL ───────────────────────

  extractPlayerSlug(h2hUrl: string): { player1Slug: string; player2Slug: string } | null {
    // URL pattern: /h2h/player1-vs-player2-12345
    const match = h2hUrl.match(/\/h2h\/(.+?)-vs-(.+?)-(\d+)$/);
    if (!match) return null;
    return {
      player1Slug: match[1],
      player2Slug: match[2],
    };
  }
}

export default TennisStatsScraper;
