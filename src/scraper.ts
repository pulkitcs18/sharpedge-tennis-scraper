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
  private h2hDebugDone = false;

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

      // DEBUG: Log page element counts
      const pageCounts = await page.evaluate(() => ({
        h2s: document.querySelectorAll('h2').length,
        widgets: document.querySelectorAll('.widget-box-shadow').length,
        dataTables: document.querySelectorAll('.data-table').length,
        dataRows: document.querySelectorAll('.data-table-row').length,
        historyRows: document.querySelectorAll('.h2h-history-row').length,
        tabs: document.querySelectorAll('.ui-toggle-link-local').length,
        activeTabs: document.querySelectorAll('.ui-toggle-target.active').length,
        h1: document.querySelector('h1')?.textContent?.trim() || 'NO H1',
      }));
      console.log(`[DEBUG] Page structure:`, JSON.stringify(pageCounts));

      // No tab clicking — use the default "All Surfaces" view as-is

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

        // Get the primary value from a cell. Two HTML patterns:
        //   Full Stats: <span>3</span>(75.0%)  → span holds the value
        //   Win %:      38<span class="fs08e">%</span> → text node holds value, span is just "%"
        // Rule: if first span starts with digit/dot/minus → use it; else use full textContent
        const getCellValue = (cell: Element): string => {
          const spans = cell.querySelectorAll(':scope > span');
          if (spans.length > 0) {
            const first = (spans[0].textContent || '').trim();
            if (/^[\d.\-]/.test(first) || first === 'N/A') {
              return first;
            }
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

        // DEBUG: Log section map summary
        const _debugSections: Record<string, any> = {};
        sectionMap.forEach((rows, heading) => {
          _debugSections[heading.substring(0, 50)] = {
            rowCount: rows.length,
            firstRowLabel: rows[0]?.label?.substring(0, 40) || 'NONE',
            firstRowP1: rows[0]?.p1?.substring(0, 20) || 'EMPTY',
            firstRowP2: rows[0]?.p2?.substring(0, 20) || 'EMPTY',
            firstRowTotal: rows[0]?.total?.substring(0, 20) || 'EMPTY',
          };
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
        const cyRow2 = cyRow.p1 ? cyRow : findValue('Full Stats', 'Calendar Year');
        const l12mRow = findValue('Full Stats', 'Last 12');
        const l12mRow2 = l12mRow.p1 ? l12mRow : findValue('Full Stats', '12 Month');

        // DEBUG: Full Stats values
        const _debugFullStats = {
          rank: `${rankRow.p1} / ${rankRow.p2}`,
          wins: `${winsRow.p1} / ${winsRow.p2}`,
          sets: `${setsRow.p1} / ${setsRow.p2}`,
          cyWinPct: `${cyRow2.p1} / ${cyRow2.p2} (full: ${cyRow2.p1Full} / ${cyRow2.p2Full})`,
          l12m: `${l12mRow2.p1} / ${l12mRow2.p2} (full: ${l12mRow2.p1Full} / ${l12mRow2.p2Full})`,
        };

        // ── Section 2: Match History (div.h2h-history-row) ──────
        // Structure: 5 child divs per row:
        //   child[0] (.w13): date as <p>Sep 30<br>2018</p>
        //   child[1] (.w25): tournament as <p>Beijing WTA<br><span>Hard</span></p>
        //   child[2] (.w25): player1 name
        //   child[3] (.w12): score with set-box-global spans
        //   child[4] (.w25): player2 name
        // Winner div has .winner class
        const matchHistory: Array<{ date: string; tournament: string; surface: string; winner: string; score: string }> = [];
        document.querySelectorAll('.h2h-history-row').forEach(row => {
          const children = Array.from(row.children) as Element[];
          if (children.length < 5) return;

          // Date from child[0]: <p>Sep 30<br>2018</p>
          // <br> causes textContent to concat without space: "Sep 302018"
          // Use innerHTML to split by <br> and rejoin with space
          const dateHTML = children[0].innerHTML;
          const dateParts = dateHTML.split(/<br\s*\/?>/i);
          const dateStr = dateParts.map(p => p.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join(' ');
          // dateStr = "Sep 30 2018"
          if (!dateStr) return;

          // Tournament + Surface from child[1]: <p>Beijing WTA<br><span>Hard</span></p>
          const tourneyHTML = children[1].innerHTML;
          const tourneyParts = tourneyHTML.split(/<br\s*\/?>/i);
          const tournament = tourneyParts[0] ? tourneyParts[0].replace(/<[^>]+>/g, '').trim() : '';
          let surface = 'Hard';
          if (tourneyParts.length > 1) {
            const surfaceText = tourneyParts.slice(1).join(' ').replace(/<[^>]+>/g, '').trim().toLowerCase();
            if (surfaceText.includes('clay')) surface = 'Clay';
            else if (surfaceText.includes('grass')) surface = 'Grass';
          }

          // Score from child[3]: set-box-global spans (e.g., <span>2</span><span>0</span>)
          const scoreEl = children[3];
          const scoreSpans = scoreEl.querySelectorAll('span');
          let score = '';
          if (scoreSpans.length >= 2) {
            score = (scoreSpans[0].textContent || '').trim() + '-' + (scoreSpans[1].textContent || '').trim();
          } else {
            const raw = (scoreEl.textContent || '').replace(/\s+/g, '').trim();
            // Handle "21" → "2-1"
            if (raw.length === 2 && /^\d{2}$/.test(raw)) {
              score = raw[0] + '-' + raw[1];
            } else {
              score = raw;
            }
          }

          // Winner: the child div (index 2 or 4) with .winner class
          let winner = '';
          if (children[2]?.classList?.contains('winner')) {
            winner = (children[2].textContent || '').replace(/\s+/g, ' ').trim();
          } else if (children[4]?.classList?.contains('winner')) {
            winner = (children[4].textContent || '').replace(/\s+/g, ' ').trim();
          }

          matchHistory.push({ date: dateStr, tournament, surface, winner, score });
        });

        // DEBUG: Match history details
        const _debugHistory = {
          totalH2HRows: document.querySelectorAll('.h2h-history-row').length,
          parsed: matchHistory.length,
          validH2H: matchHistory.filter(m => /^\d+-\d+$/.test(m.score) && m.winner).length,
          invalidEntries: matchHistory.filter(m => !/^\d+-\d+$/.test(m.score) || !m.winner).map(m => ({
            date: m.date, score: m.score, winner: m.winner || 'NO_WINNER',
          })).slice(0, 5),
          validEntries: matchHistory.filter(m => /^\d+-\d+$/.test(m.score) && m.winner).map(m => ({
            date: m.date, score: m.score, winner: m.winner, surface: m.surface,
          })),
        };

        // ── Sections 3-8: Just grab FIRST row from each section ──
        // Each section's first data row is the headline stat we need
        const empty = { p1: '', p2: '', total: '', p1Full: '', p2Full: '', label: '' };
        const getFirstRow = (headingKeyword: string) => {
          const hk = headingKeyword.toLowerCase();
          for (const [heading, rows] of sectionMap.entries()) {
            if (!heading.toLowerCase().includes(hk)) continue;
            if (rows.length > 0) return rows[0];
          }
          return empty;
        };

        const winPctRow = getFirstRow('Win Percentage');  // → Match Wins %
        const acesRow = getFirstRow('Aces');              // → Aces Per Match
        const dfRow = getFirstRow('Double Faults');       // → DFs Per Match
        const brRow = getFirstRow('Break');               // → Breaks Per Match
        const tbRow = getFirstRow('Tie Break');           // → TBs Per Match
        const gamesRow = getFirstRow('Match Total Games');// → Avg Games in a Set

        // DEBUG: First row values from each section
        const _debugFirstRows = {
          winPct: { label: (winPctRow as any).label, p1: winPctRow.p1, p2: winPctRow.p2, p1Full: winPctRow.p1Full, p2Full: winPctRow.p2Full },
          aces: { label: (acesRow as any).label, p1: acesRow.p1, p2: acesRow.p2, total: acesRow.total },
          dfs: { label: (dfRow as any).label, p1: dfRow.p1, p2: dfRow.p2, total: dfRow.total },
          breaks: { label: (brRow as any).label, p1: brRow.p1, p2: brRow.p2, total: brRow.total },
          tiebreaks: { label: (tbRow as any).label, p1: tbRow.p1, p2: tbRow.p2, total: tbRow.total },
          games: { label: (gamesRow as any).label, p1: gamesRow.p1, p2: gamesRow.p2, total: gamesRow.total },
        };

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
          // Win % (first row = Match Wins %)
          p1MatchWinsPct: parsePct(winPctRow.p1Full || winPctRow.p1),
          p2MatchWinsPct: parsePct(winPctRow.p2Full || winPctRow.p2),
          p1StraightSetsPct: 0,
          p2StraightSetsPct: 0,
          p1WinsFromBehindPct: 0,
          p2WinsFromBehindPct: 0,
          p1Set1WinPct: 0,
          p2Set1WinPct: 0,
          p1Set2WinPct: 0,
          p2Set2WinPct: 0,
          p1Set3WinPct: 0,
          p2Set3WinPct: 0,
          // Aces (first row = Aces Per Match)
          p1AcesPerMatch: parseNum(acesRow.p1),
          p2AcesPerMatch: parseNum(acesRow.p2),
          acesMatchTotal: parseNum(acesRow.total),
          // Double Faults (first row = DFs Per Match)
          p1DoubleFaultsPerMatch: parseNum(dfRow.p1),
          p2DoubleFaultsPerMatch: parseNum(dfRow.p2),
          doubleFaultsMatchTotal: parseNum(dfRow.total),
          // Breaks (first row = Breaks Per Match)
          p1BreaksPerMatch: parseNum(brRow.p1),
          p2BreaksPerMatch: parseNum(brRow.p2),
          breaksMatchTotal: parseNum(brRow.total),
          // Tiebreaks (first row = TBs Per Match)
          p1TiebreaksPerMatch: parseNum(tbRow.p1),
          p2TiebreaksPerMatch: parseNum(tbRow.p2),
          tiebreaksAverage: parseNum(tbRow.total),
          // Match Total Games (first row = Avg Games in a Set)
          p1AvgGamesPerSet: parseNum(gamesRow.p1),
          p2AvgGamesPerSet: parseNum(gamesRow.p2),
          avgGamesPerSet: parseNum(gamesRow.total),
          gamesOver20_5Pct: 0,
          gamesOver21_5Pct: 0,
          gamesOver22_5Pct: 0,
          gamesOver23_5Pct: 0,
          gamesOver24_5Pct: 0,
          // Raw
          rawData,
          // DEBUG: all debug data bundled for logging
          _debug: {
            sections: _debugSections,
            fullStats: _debugFullStats,
            history: _debugHistory,
            firstRows: _debugFirstRows,
          },
        };
      }, h2hUrl);

      await page.close();

      // DEBUG: Log full extraction details for first H2H page
      if (data && !this.h2hDebugDone) {
        this.h2hDebugDone = true;
        const d = (data as any)._debug;
        console.log(`\n[DEBUG] ═══ FULL H2H EXTRACTION REPORT ═══`);
        console.log(`[DEBUG] Players: ${data.player1} vs ${data.player2}`);
        console.log(`[DEBUG] URL: ${h2hUrl}`);
        console.log(`[DEBUG]\n── Section Map ──`);
        console.log(JSON.stringify(d.sections, null, 2));
        console.log(`[DEBUG]\n── Full Stats Raw Values ──`);
        console.log(JSON.stringify(d.fullStats, null, 2));
        console.log(`[DEBUG]\n── First Row Per Section ──`);
        console.log(JSON.stringify(d.firstRows, null, 2));
        console.log(`[DEBUG]\n── Match History ──`);
        console.log(JSON.stringify(d.history, null, 2));
        console.log(`[DEBUG]\n── Final Parsed Values ──`);
        console.log(JSON.stringify({
          rank: `${data.p1Rank} / ${data.p2Rank}`,
          h2hWins: `${data.p1H2HWins} - ${data.p2H2HWins}`,
          h2hSets: `${data.p1H2HSets} - ${data.p2H2HSets}`,
          cyWinPct: `${data.p1CalendarYearWinPct}% / ${data.p2CalendarYearWinPct}%`,
          l12mWinPct: `${data.p1Last12mWinPct}% / ${data.p2Last12mWinPct}%`,
          matchWinPct: `${data.p1MatchWinsPct}% / ${data.p2MatchWinsPct}%`,
          aces: `${data.p1AcesPerMatch} / ${data.p2AcesPerMatch} / ${data.acesMatchTotal}`,
          dfs: `${data.p1DoubleFaultsPerMatch} / ${data.p2DoubleFaultsPerMatch} / ${data.doubleFaultsMatchTotal}`,
          breaks: `${data.p1BreaksPerMatch} / ${data.p2BreaksPerMatch} / ${data.breaksMatchTotal}`,
          tiebreaks: `${data.p1TiebreaksPerMatch} / ${data.p2TiebreaksPerMatch} / ${data.tiebreaksAverage}`,
          games: `${data.p1AvgGamesPerSet} / ${data.p2AvgGamesPerSet} / ${data.avgGamesPerSet}`,
          historyCount: data.matchHistory.length,
        }, null, 2));
        console.log(`[DEBUG] ═══ END REPORT ═══\n`);
      }

      return data as H2HData;

    } catch (err: any) {
      await page.close();
      throw err;
    }
  }
}

export default TennisStatsScraper;
