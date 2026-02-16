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
  private h2hDebugDone = false; // Only dump debug HTML for the first H2H page

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

  // ─── H2H Detail Page — DIV-BASED EXTRACTION (TennisStats uses divs, not tables) ─

  async scrapeH2HWithCookies(h2hUrl: string, cookiesJson: string): Promise<H2HData | null> {
    const page = await this.newPageWithCookies(cookiesJson);

    try {
      await page.goto(h2hUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for div-based data containers to load
      await page.waitForSelector('.data-table-row', { timeout: 10000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      // Check Cloudflare
      const pageText = await page.evaluate(() => document.body.textContent || '');
      if (pageText.includes('Performing security verification') || pageText.includes('Just a moment')) {
        await page.close();
        return null;
      }

      if (!pageText.toLowerCase().includes('head to head') &&
          !pageText.toLowerCase().includes('h2h') &&
          !pageText.toLowerCase().includes(' vs ')) {
        console.log('[H2H] Page rejected — no H2H/vs content. First 300 chars:', pageText.substring(0, 300));
        await page.close();
        return null;
      }

      // Click "Calendar Year" tabs (uses div.ui-toggle-link-local with data-id)
      await page.evaluate(() => {
        document.querySelectorAll('.ui-toggle-link-local').forEach((tab: any) => {
          const text = (tab.textContent || '').trim().toLowerCase();
          if (text.includes('calendar year') || text.includes('2026')) {
            tab.click();
          }
        });
      });
      await new Promise(r => setTimeout(r, 500));

      // Click "3 Set Matches" tabs if present
      await page.evaluate(() => {
        document.querySelectorAll('.ui-toggle-link-local').forEach((tab: any) => {
          const text = (tab.textContent || '').trim().toLowerCase();
          if (text === '3 set matches' || text.includes('3 set')) {
            tab.click();
          }
        });
      });
      await new Promise(r => setTimeout(r, 500));

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

        // Get the primary text value from a cell (first <span> text)
        const getCellValue = (cell: Element): string => {
          const spans = cell.querySelectorAll(':scope > span');
          if (spans.length > 0) {
            return (spans[0].textContent || '').trim();
          }
          return (cell.textContent || '').replace(/\s+/g, ' ').trim();
        };

        // Get full text of a cell (all spans combined)
        const getCellFullText = (cell: Element): string => {
          return (cell.textContent || '').replace(/\s+/g, ' ').trim();
        };

        // ── Build section map: H2 heading → data-table-rows ─────
        // Structure: div.widget-box-shadow contains div.widget-header > h2
        //   and div.data-table > div.data-table-row children
        //   For tabbed sections: div.ui-toggle-target.active > div.data-table
        type SectionRow = { label: string; p1: string; p2: string; total: string; p1Full: string; p2Full: string };
        const sectionMap: Map<string, SectionRow[]> = new Map();

        document.querySelectorAll('h2').forEach(h2 => {
          const heading = (h2.textContent || '').trim();
          if (!heading || heading.length > 200) return;

          // Walk up to the widget container
          let widget: Element | null = h2;
          while (widget && !(widget.classList?.contains('widget-box-shadow') || widget.classList?.contains('widget-sidebar-ranking'))) {
            widget = widget.parentElement;
          }
          if (!widget) return;

          // For tabbed sections, prefer the active toggle target
          const activeTarget = widget.querySelector('.ui-toggle-target.active');
          const container = activeTarget || widget;

          // Find all data-table containers within
          const dataTables = container.querySelectorAll('.data-table');
          const rows: SectionRow[] = [];

          dataTables.forEach(dt => {
            dt.querySelectorAll('.data-table-row').forEach(row => {
              const children = Array.from(row.children) as Element[];
              if (children.length < 2) return;

              // First child (with .fitem class) is the label
              const labelCell = children[0];
              const label = getCellFullText(labelCell);

              // Remaining children are P1, P2, and optionally Total
              const p1 = children.length > 1 ? getCellValue(children[1]) : '';
              const p2 = children.length > 2 ? getCellValue(children[2]) : '';
              const total = children.length > 3 ? getCellValue(children[3]) : '';
              const p1Full = children.length > 1 ? getCellFullText(children[1]) : '';
              const p2Full = children.length > 2 ? getCellFullText(children[2]) : '';

              if (label) {
                rows.push({ label, p1, p2, total, p1Full, p2Full });
              }
            });
          });

          if (rows.length > 0) {
            sectionMap.set(heading, rows);
          }
        });

        // Helper: find a value by heading keyword + label keyword
        const findValue = (headingKeyword: string, labelKeyword: string): { p1: string; p2: string; total: string; p1Full: string; p2Full: string } => {
          const hkLower = headingKeyword.toLowerCase();
          const lkLower = labelKeyword.toLowerCase();

          for (const [heading, rows] of sectionMap.entries()) {
            if (!heading.toLowerCase().includes(hkLower)) continue;
            for (const row of rows) {
              if (row.label.toLowerCase().includes(lkLower)) {
                return row;
              }
            }
          }
          return { p1: '', p2: '', total: '', p1Full: '', p2Full: '' };
        };

        // ── Extract Player Names from H1 ────────────────────────
        const h1 = document.querySelector('h1')?.textContent || '';
        const vsMatch = h1.match(/(.+?)\s+vs\.?\s+(.+?)(?:\s+Head|\s+H2H|\s+Stats|\s*$)/i);
        if (!vsMatch) return null;

        const player1 = vsMatch[1].trim();
        const player2 = vsMatch[2].trim();
        const urlMatch = url.match(/\/h2h\/(.+?)$/);
        const h2hKey = urlMatch ? urlMatch[1] : player1 + '-vs-' + player2;

        // ── Section 1: Full Stats ───────────────────────────────
        const rankRow = findValue('Full Stats', 'Current Rank');
        const winsRow = findValue('Full Stats', 'Wins');
        const setsRow = findValue('Full Stats', 'Sets Won');
        const cyRow = findValue('Full Stats', 'Win Percentage');
        // Calendar year row has label "Win Percentage 2026 Calendar Year"
        const cyRow2 = cyRow.p1 ? cyRow : findValue('Full Stats', 'Calendar Year');
        const l12mRow = findValue('Full Stats', 'Last 12');
        const l12mRow2 = l12mRow.p1 ? l12mRow : findValue('Full Stats', '12 Month');

        // ── Section 2: Match History (div.h2h-history-row) ──────
        const matchHistory: Array<{ date: string; tournament: string; surface: string; winner: string; score: string }> = [];
        document.querySelectorAll('.h2h-history-row').forEach(row => {
          const text = (row.textContent || '').replace(/\s+/g, ' ').trim();

          // Extract date (e.g., "Nov 1 2025", "Feb 25 2025")
          const dateMatch = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}[\s,]+\d{4}/i);
          if (!dateMatch) return;

          // Extract score (e.g., "2-0", "2-1")
          const scoreMatch = text.match(/(\d+)\s*-\s*(\d+)/);

          // Extract tournament name — usually between date and surface/score
          // Look for text patterns
          const tournamentMatch = text.match(/\d{4}\s+(.+?)(?:\s+Hard|\s+Clay|\s+Grass|\s+\d+-\d+)/i);
          const tournament = tournamentMatch ? tournamentMatch[1].trim() : '';

          // Surface detection
          let surface = 'Hard';
          if (text.toLowerCase().includes('clay')) surface = 'Clay';
          else if (text.toLowerCase().includes('grass')) surface = 'Grass';

          // Winner detection: look for bold element within the row
          let winner = '';
          const boldEls = row.querySelectorAll('.bold, .good, strong, b');
          boldEls.forEach(b => {
            const bText = (b.textContent || '').trim();
            if (bText.includes(player1.split(' ').pop() || '')) winner = player1;
            else if (bText.includes(player2.split(' ').pop() || '')) winner = player2;
          });

          matchHistory.push({
            date: dateMatch[0],
            tournament,
            surface,
            winner,
            score: scoreMatch ? scoreMatch[0] : '',
          });
        });

        // ── Section 3: Win % Breakdown ──────────────────────────
        const mwRow = findValue('Win Percentage', 'Match Wins');
        const ssRow = findValue('Win Percentage', 'Straight Sets');
        const ssRow2 = ssRow.p1 ? ssRow : findValue('Win Percentage', 'Wins in Straight');
        const wfbRow = findValue('Win Percentage', 'From Behind');
        const wfbRow2 = wfbRow.p1 ? wfbRow : findValue('Win Percentage', 'Wins From Behind');
        const s1Row = findValue('Win Percentage', 'Set 1');
        const s2Row = findValue('Win Percentage', 'Set 2');
        const s3Row = findValue('Win Percentage', 'Set 3');

        // ── Section 4: Aces ─────────────────────────────────────
        const acesRow = findValue('Aces', 'Aces Per Match');
        const acesRow2 = acesRow.p1 ? acesRow : findValue('Aces', 'Per Match');

        // ── Section 5: Double Faults ────────────────────────────
        const dfRow = findValue('Double Faults', 'Double Faults Per Match');
        const dfRow2 = dfRow.p1 ? dfRow : findValue('Double Faults', 'Per Match');

        // ── Section 6: Breaks ───────────────────────────────────
        const brRow = findValue('Break', 'Breaks Per Match');
        const brRow2 = brRow.p1 ? brRow : findValue('Break', 'Per Match');

        // ── Section 7: Tiebreaks ────────────────────────────────
        const tbRow = findValue('Tie Break', 'Tie Breaks Per Match');
        const tbRow2 = tbRow.p1 ? tbRow : findValue('Tie Break', 'Per Match');

        // ── Section 8: Match Total Games ────────────────────────
        const avgGRow = findValue('Match Total Games', 'Average Games');
        const avgGRow2 = avgGRow.p1 ? avgGRow : findValue('Match Total Games', 'Average');
        const o205Row = findValue('Match Total Games', 'Over 20.5');
        const o215Row = findValue('Match Total Games', 'Over 21.5');
        const o225Row = findValue('Match Total Games', 'Over 22.5');
        const o235Row = findValue('Match Total Games', 'Over 23.5');
        const o245Row = findValue('Match Total Games', 'Over 24.5');

        // ── Build raw dump for debugging ────────────────────────
        const rawData: any = {};
        let sectionIdx = 0;
        sectionMap.forEach((rows, heading) => {
          rawData['section_' + sectionIdx + '_' + heading.substring(0, 40)] = rows.slice(0, 5).map(r => ({
            label: r.label, p1: r.p1, p2: r.p2, total: r.total,
          }));
          sectionIdx++;
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
          p1CalendarYearWinPct: parsePct(cyRow2.p1Full || cyRow2.p1),
          p1CalendarYearRecord: cyRow2.p1Full || cyRow2.p1 || '',
          p2CalendarYearWinPct: parsePct(cyRow2.p2Full || cyRow2.p2),
          p2CalendarYearRecord: cyRow2.p2Full || cyRow2.p2 || '',
          p1Last12mWinPct: parsePct(l12mRow2.p1Full || l12mRow2.p1),
          p1Last12mRecord: l12mRow2.p1Full || l12mRow2.p1 || '',
          p2Last12mWinPct: parsePct(l12mRow2.p2Full || l12mRow2.p2),
          p2Last12mRecord: l12mRow2.p2Full || l12mRow2.p2 || '',
          // Match History
          matchHistory,
          // Win % Breakdown
          p1MatchWinsPct: parsePct(mwRow.p1Full || mwRow.p1),
          p2MatchWinsPct: parsePct(mwRow.p2Full || mwRow.p2),
          p1StraightSetsPct: parsePct(ssRow2.p1Full || ssRow2.p1),
          p2StraightSetsPct: parsePct(ssRow2.p2Full || ssRow2.p2),
          p1WinsFromBehindPct: parsePct(wfbRow2.p1Full || wfbRow2.p1),
          p2WinsFromBehindPct: parsePct(wfbRow2.p2Full || wfbRow2.p2),
          p1Set1WinPct: parsePct(s1Row.p1Full || s1Row.p1),
          p2Set1WinPct: parsePct(s1Row.p2Full || s1Row.p2),
          p1Set2WinPct: parsePct(s2Row.p1Full || s2Row.p1),
          p2Set2WinPct: parsePct(s2Row.p2Full || s2Row.p2),
          p1Set3WinPct: parsePct(s3Row.p1Full || s3Row.p1),
          p2Set3WinPct: parsePct(s3Row.p2Full || s3Row.p2),
          // Serve & Return
          p1AcesPerMatch: parseNum(acesRow2.p1),
          p2AcesPerMatch: parseNum(acesRow2.p2),
          acesMatchTotal: parseNum(acesRow2.total),
          p1DoubleFaultsPerMatch: parseNum(dfRow2.p1),
          p2DoubleFaultsPerMatch: parseNum(dfRow2.p2),
          doubleFaultsMatchTotal: parseNum(dfRow2.total),
          p1BreaksPerMatch: parseNum(brRow2.p1),
          p2BreaksPerMatch: parseNum(brRow2.p2),
          breaksMatchTotal: parseNum(brRow2.total),
          p1TiebreaksPerMatch: parseNum(tbRow2.p1),
          p2TiebreaksPerMatch: parseNum(tbRow2.p2),
          tiebreaksAverage: parseNum(tbRow2.total),
          // Match Total Games
          p1AvgGamesPerSet: parseNum(avgGRow2.p1),
          p2AvgGamesPerSet: parseNum(avgGRow2.p2),
          avgGamesPerSet: parseNum(avgGRow2.total),
          gamesOver20_5Pct: parsePct(o205Row.total || o205Row.p1),
          gamesOver21_5Pct: parsePct(o215Row.total || o215Row.p1),
          gamesOver22_5Pct: parsePct(o225Row.total || o225Row.p1),
          gamesOver23_5Pct: parsePct(o235Row.total || o235Row.p1),
          gamesOver24_5Pct: parsePct(o245Row.total || o245Row.p1),
          // Raw
          rawData,
        };
      }, h2hUrl);

      await page.close();

      // Log extraction summary for first few pages
      if (data && !this.h2hDebugDone) {
        console.log(`[H2H] Raw sections found:`, JSON.stringify(data.rawData, null, 2).substring(0, 500));
      }

      return data as H2HData;

    } catch (err: any) {
      await page.close();
      throw err;
    }
  }
}

export default TennisStatsScraper;
