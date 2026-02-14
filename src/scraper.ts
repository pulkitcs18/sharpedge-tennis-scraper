/**
 * TennisStats.com Scraper — Premium Cookie Mode v2
 * 
 * Scrapes homepage (free) + ALL detail page tables (with Premium cookies)
 * Extracts: Full Stats, Match History, Win %, Aces, Games, Breaks, DFs, Tiebreaks
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DailyMatch {
  tournament: string;
  tournamentTier?: string;
  tournamentOfficialName?: string;
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

export interface H2HData {
  h2hKey: string;
  player1: string;
  player2: string;
  // Full Stats
  p1Rank: number;
  p2Rank: number;
  p1H2HWins: number;
  p2H2HWins: number;
  p1H2HSets: number;
  p2H2HSets: number;
  p1CalendarYearWinPct: number;
  p1CalendarYearRecord: string;
  p2CalendarYearWinPct: number;
  p2CalendarYearRecord: string;
  p1Last12mWinPct: number;
  p1Last12mRecord: string;
  p2Last12mWinPct: number;
  p2Last12mRecord: string;
  // Match History
  matchHistory: Array<{
    date: string;
    tournament: string;
    surface: string;
    winner: string;
    score: string;
  }>;
  // Win Percentage Breakdown (Calendar Year, 3-Set)
  p1MatchWinsPct: number;
  p2MatchWinsPct: number;
  p1StraightSetsPct: number;
  p2StraightSetsPct: number;
  p1WinsFromBehindPct: number;
  p2WinsFromBehindPct: number;
  p1Set1WinPct: number;
  p2Set1WinPct: number;
  p1Set2WinPct: number;
  p2Set2WinPct: number;
  p1Set3WinPct: number;
  p2Set3WinPct: number;
  // Serve & Return Stats (Calendar Year, 3-Set)
  p1AcesPerMatch: number;
  p2AcesPerMatch: number;
  acesMatchTotal: number;
  p1DoubleFaultsPerMatch: number;
  p2DoubleFaultsPerMatch: number;
  doubleFaultsMatchTotal: number;
  p1BreaksPerMatch: number;
  p2BreaksPerMatch: number;
  breaksMatchTotal: number;
  p1TiebreaksPerMatch: number;
  p2TiebreaksPerMatch: number;
  tiebreaksAverage: number;
  // Match Total Games (Calendar Year, 3-Set)
  p1AvgGamesPerSet: number;
  p2AvgGamesPerSet: number;
  avgGamesPerSet: number;
  gamesOver20_5Pct: number;
  gamesOver21_5Pct: number;
  gamesOver22_5Pct: number;
  gamesOver23_5Pct: number;
  gamesOver24_5Pct: number;
  // Raw fallback
  rawData: any;
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

  // ─── Daily Matches (Homepage) ───────────────────────────────────────────

  async scrapeDailyMatches(date?: string, cookiesJson?: string): Promise<DailyMatch[]> {
    const page = cookiesJson ? await this.newPageWithCookies(cookiesJson) : await this.newPage();
    const url = date ? `${this.baseUrl}/${date}` : this.baseUrl;
    
    console.log(`[TennisStats] Scraping daily matches from ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    await page.waitForSelector('a[href*="/h2h/"]', { timeout: 20000 }).catch(() => {
      console.warn('[TennisStats] No match links found or timeout');
    });

    await new Promise(r => setTimeout(r, 3000));

    // Check for Cloudflare
    const bodyText = await page.evaluate(() => document.body.textContent || '');
    if (bodyText.includes('Performing security verification') || bodyText.includes('Just a moment')) {
      console.error('[TennisStats] ❌ Cloudflare is blocking!');
      await page.close();
      return [];
    }

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
          scheduledTime, status,
          h2hUrl: href.startsWith('http') ? href : 'https://tennisstats.com' + href,
        });
      });

      // Extract tournament context
      const sections = document.querySelectorAll('h2, a[href*="/h2h/"]');
      let currentTournament = '', currentCountry = '';
      let currentGender = 'Men', currentCategory = 'Singles';
      let currentSurface = 'Hard', currentRound = 'Main';
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
          currentGender = parentText.includes('Women') ? 'Women' : 'Men';
          currentCategory = parentText.includes('Doubles') ? 'Doubles' : 'Singles';
          if (parentText.includes('Clay')) currentSurface = 'Clay';
          else if (parentText.includes('Grass')) currentSurface = 'Grass';
          else currentSurface = 'Hard';
          currentRound = parentText.includes('Qualification') ? 'Qualification' : 'Main';
        } else {
          const href = el.getAttribute('href') || '';
          if (href.includes('/h2h/')) {
            const fullUrl = href.startsWith('http') ? href : 'https://tennisstats.com' + href;
            tournamentMap.set(fullUrl, {
              tournament: currentTournament, country: currentCountry,
              gender: currentGender, category: currentCategory,
              surface: currentSurface, round: currentRound,
            });
          }
        }
      });

      return results.map((r: any) => ({ ...r, ...(tournamentMap.get(r.h2hUrl) || {}) }));
    });

    await page.close();
    console.log(`[TennisStats] Found ${matches.length} matches`);
    return matches as DailyMatch[];
  }

  // ─── H2H Detail Page — COMPREHENSIVE EXTRACTION ────────────────────────

  async scrapeH2HWithCookies(h2hUrl: string, cookiesJson: string): Promise<H2HData | null> {
    const page = await this.newPageWithCookies(cookiesJson);

    try {
      await page.goto(h2hUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for tables to load
      await page.waitForSelector('table', { timeout: 10000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));

      // Check Cloudflare
      const pageText = await page.evaluate(() => document.body.textContent || '');
      if (pageText.includes('Performing security verification') || pageText.includes('Just a moment')) {
        await page.close();
        return null;
      }

      if (!pageText.toLowerCase().includes('head to head') && 
          !pageText.toLowerCase().includes('h2h') &&
          !pageText.toLowerCase().includes(' vs ')) {
        await page.close();
        return null;
      }

      // Click "2026 Calendar Year" tab and "3 Set Matches" tab if present
      // This ensures we get the right data view
      await page.evaluate(() => {
        const tabs = document.querySelectorAll('a, button, [role="tab"], .nav-link, .tab');
        tabs.forEach((tab: any) => {
          const text = (tab.textContent || '').trim().toLowerCase();
          if (text.includes('calendar year') || text.includes('2026')) {
            tab.click();
          }
        });
      });
      await new Promise(r => setTimeout(r, 1000));

      await page.evaluate(() => {
        const tabs = document.querySelectorAll('a, button, [role="tab"], .nav-link, .tab');
        tabs.forEach((tab: any) => {
          const text = (tab.textContent || '').trim().toLowerCase();
          if (text === '3 set matches' || text.includes('3 set')) {
            tab.click();
          }
        });
      });
      await new Promise(r => setTimeout(r, 1000));

      const data = await page.evaluate((url: string) => {
        // ── Helpers ──────────────────────────────────────────────
        const parseNum = (s: string | null | undefined): number => {
          if (!s || s === 'N/A' || s === '-') return 0;
          const cleaned = s.replace(/[^0-9.\-]/g, '');
          return parseFloat(cleaned) || 0;
        };

        const parsePct = (s: string | null | undefined): number => {
          if (!s || s === 'N/A' || s === '-') return 0;
          const m = s.match(/([\d.]+)\s*%/);
          return m ? parseFloat(m[1]) : 0;
        };

        // Scan ALL tables on page and build a structured map
        const allTableData: Array<{ heading: string; rows: Array<{ label: string; p1: string; p2: string; total: string }> }> = [];

        // Strategy: Walk through the DOM looking for heading + table pairs
        const allElements = document.body.querySelectorAll('*');
        let currentHeading = '';
        
        allElements.forEach(el => {
          // Track headings
          if (['H1', 'H2', 'H3', 'H4', 'H5'].includes(el.tagName)) {
            const t = (el.textContent || '').trim();
            if (t.length > 2 && t.length < 200) {
              currentHeading = t;
            }
          }
          
          // Process tables
          if (el.tagName === 'TABLE') {
            const rows: Array<{ label: string; p1: string; p2: string; total: string }> = [];
            const trs = el.querySelectorAll('tr');
            
            trs.forEach(tr => {
              const tds = tr.querySelectorAll('td');
              if (tds.length >= 3) {
                const label = (tds[0].textContent || '').trim();
                const p1 = (tds[1].textContent || '').trim();
                const p2 = (tds[2].textContent || '').trim();
                const total = tds.length >= 4 ? (tds[3].textContent || '').trim() : '';
                if (label && label.length < 100) {
                  rows.push({ label, p1, p2, total });
                }
              }
            });
            
            if (rows.length > 0) {
              allTableData.push({ heading: currentHeading, rows });
            }
          }
        });

        // Helper: find rows by heading keyword and label keyword
        const findValue = (headingKeyword: string, labelKeyword: string): { p1: string; p2: string; total: string } => {
          const hkLower = headingKeyword.toLowerCase();
          const lkLower = labelKeyword.toLowerCase();
          
          for (const table of allTableData) {
            if (!table.heading.toLowerCase().includes(hkLower)) continue;
            for (const row of table.rows) {
              if (row.label.toLowerCase().includes(lkLower)) {
                return { p1: row.p1, p2: row.p2, total: row.total };
              }
            }
          }
          return { p1: '', p2: '', total: '' };
        };

        // ── Extract Player Names ────────────────────────────────
        const h1 = document.querySelector('h1')?.textContent || '';
        const vsMatch = h1.match(/(.+?)\s+vs\.?\s+(.+?)(?:\s+Head|\s+H2H|\s*$)/i);
        if (!vsMatch) return null;

        const player1 = vsMatch[1].trim();
        const player2 = vsMatch[2].trim();
        const urlMatch = url.match(/\/h2h\/(.+?)$/);
        const h2hKey = urlMatch ? urlMatch[1] : player1 + '-vs-' + player2;

        // ── Section 1: Full Stats ───────────────────────────────
        const rankRow = findValue('Full Stats', 'Current Rank');
        const winsRow = findValue('Full Stats', 'Wins');
        const setsRow = findValue('Full Stats', 'Sets Won');
        const cyRow = findValue('Full Stats', 'Calendar Year');
        // Fallback: also check for year-specific labels
        const cyRow2 = cyRow.p1 ? cyRow : findValue('Full Stats', '202');
        const l12mRow = findValue('Full Stats', 'Last 12');
        // Fallback
        const l12mRow2 = l12mRow.p1 ? l12mRow : findValue('Full Stats', '12 Month');

        // ── Section 2: Match History ────────────────────────────
        const matchHistory: any[] = [];
        for (const table of allTableData) {
          if (!table.heading.toLowerCase().includes('head-to-head record') &&
              !table.heading.toLowerCase().includes('h2h record')) continue;
          
          for (const row of table.rows) {
            // Rows with dates like "Nov 1 2025" or "Feb 25 2025"
            const dateMatch = row.label.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
            if (dateMatch) {
              // In the H2H record table: Date | Tournament | Score/Result
              const scoreMatch = (row.p2 + ' ' + row.total).match(/(\d+)\s*-\s*(\d+)/);
              matchHistory.push({
                date: row.label,
                tournament: row.p1,
                surface: row.p1.toLowerCase().includes('clay') ? 'Clay' : 
                         row.p1.toLowerCase().includes('grass') ? 'Grass' : 'Hard',
                winner: '', // Will determine from bold/highlight
                score: scoreMatch ? scoreMatch[0] : row.p2,
              });
            }
          }
        }

        // Also try scanning for the history table by looking at all tables with date patterns
        if (matchHistory.length === 0) {
          for (const table of allTableData) {
            for (const row of table.rows) {
              const fullText = row.label + ' ' + row.p1 + ' ' + row.p2 + ' ' + row.total;
              const dateMatch = fullText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}[\s,]+\d{4}/i);
              const scoreMatch = fullText.match(/(\d+)\s*-\s*(\d+)/);
              if (dateMatch && scoreMatch) {
                matchHistory.push({
                  date: dateMatch[0],
                  tournament: row.p1 || row.label,
                  surface: 'Hard',
                  winner: '',
                  score: scoreMatch[0],
                });
              }
            }
          }
        }

        // ── Section 3: Win % Breakdown ──────────────────────────
        const mwRow = findValue('Win Percentage', 'Match Wins');
        const ssRow = findValue('Win Percentage', 'Straight Sets');
        // Fallback for straight sets
        const ssRow2 = ssRow.p1 ? ssRow : findValue('Win Percentage', 'Wins in Straight');
        const wfbRow = findValue('Win Percentage', 'From Behind');
        const wfbRow2 = wfbRow.p1 ? wfbRow : findValue('Win Percentage', 'Wins From Behind');
        const s1Row = findValue('Win Percentage', 'Set 1 Win');
        const s2Row = findValue('Win Percentage', 'Set 2 Win');
        const s3Row = findValue('Win Percentage', 'Set 3 Win');

        // ── Section 4: Aces ─────────────────────────────────────
        const acesRow = findValue('Aces', 'Aces Per Match');

        // ── Section 5: Double Faults ────────────────────────────
        const dfRow = findValue('Double Faults', 'Double Faults Per Match');

        // ── Section 6: Breaks ───────────────────────────────────
        const brRow = findValue('Break', 'Breaks Per Match');

        // ── Section 7: Tiebreaks ────────────────────────────────
        const tbRow = findValue('Tie Break', 'Tie Breaks Per Match');
        const tbRow2 = tbRow.p1 ? tbRow : findValue('Tiebreak', 'Per Match');

        // ── Section 8: Match Total Games ────────────────────────
        const avgGRow = findValue('Match Total Games', 'Average Games');
        const o205Row = findValue('Match Total Games', 'Over 20.5');
        const o215Row = findValue('Match Total Games', 'Over 21.5');
        const o225Row = findValue('Match Total Games', 'Over 22.5');
        const o235Row = findValue('Match Total Games', 'Over 23.5');
        const o245Row = findValue('Match Total Games', 'Over 24.5');

        // ── Build raw dump for debugging ────────────────────────
        const rawData: any = {};
        allTableData.forEach((t, i) => {
          rawData['table_' + i + '_' + t.heading.substring(0, 40)] = t.rows.slice(0, 5).map(r => ({
            label: r.label, p1: r.p1, p2: r.p2,
          }));
        });

        return {
          h2hKey,
          player1,
          player2,
          // Full Stats
          p1Rank: parseNum(rankRow.p1),
          p2Rank: parseNum(rankRow.p2),
          p1H2HWins: parseNum(winsRow.p1),
          p2H2HWins: parseNum(winsRow.p2),
          p1H2HSets: parseNum(setsRow.p1),
          p2H2HSets: parseNum(setsRow.p2),
          p1CalendarYearWinPct: parsePct(cyRow2.p1),
          p1CalendarYearRecord: cyRow2.p1 || '',
          p2CalendarYearWinPct: parsePct(cyRow2.p2),
          p2CalendarYearRecord: cyRow2.p2 || '',
          p1Last12mWinPct: parsePct(l12mRow2.p1),
          p1Last12mRecord: l12mRow2.p1 || '',
          p2Last12mWinPct: parsePct(l12mRow2.p2),
          p2Last12mRecord: l12mRow2.p2 || '',
          // Match History
          matchHistory,
          // Win % Breakdown
          p1MatchWinsPct: parsePct(mwRow.p1),
          p2MatchWinsPct: parsePct(mwRow.p2),
          p1StraightSetsPct: parsePct(ssRow2.p1),
          p2StraightSetsPct: parsePct(ssRow2.p2),
          p1WinsFromBehindPct: parsePct(wfbRow2.p1),
          p2WinsFromBehindPct: parsePct(wfbRow2.p2),
          p1Set1WinPct: parsePct(s1Row.p1),
          p2Set1WinPct: parsePct(s1Row.p2),
          p1Set2WinPct: parsePct(s2Row.p1),
          p2Set2WinPct: parsePct(s2Row.p2),
          p1Set3WinPct: parsePct(s3Row.p1),
          p2Set3WinPct: parsePct(s3Row.p2),
          // Serve & Return
          p1AcesPerMatch: parseNum(acesRow.p1),
          p2AcesPerMatch: parseNum(acesRow.p2),
          acesMatchTotal: parseNum(acesRow.total),
          p1DoubleFaultsPerMatch: parseNum(dfRow.p1),
          p2DoubleFaultsPerMatch: parseNum(dfRow.p2),
          doubleFaultsMatchTotal: parseNum(dfRow.total),
          p1BreaksPerMatch: parseNum(brRow.p1),
          p2BreaksPerMatch: parseNum(brRow.p2),
          breaksMatchTotal: parseNum(brRow.total),
          p1TiebreaksPerMatch: parseNum(tbRow2.p1),
          p2TiebreaksPerMatch: parseNum(tbRow2.p2),
          tiebreaksAverage: parseNum(tbRow2.total),
          // Match Total Games
          p1AvgGamesPerSet: parseNum(avgGRow.p1),
          p2AvgGamesPerSet: parseNum(avgGRow.p2),
          avgGamesPerSet: parseNum(avgGRow.total),
          gamesOver20_5Pct: parsePct(o205Row.total),
          gamesOver21_5Pct: parsePct(o215Row.total),
          gamesOver22_5Pct: parsePct(o225Row.total),
          gamesOver23_5Pct: parsePct(o235Row.total),
          gamesOver24_5Pct: parsePct(o245Row.total),
          // Raw
          rawData,
        };
      }, h2hUrl);

      await page.close();
      return data as H2HData;

    } catch (err: any) {
      await page.close();
      throw err;
    }
  }
}

export default TennisStatsScraper;
