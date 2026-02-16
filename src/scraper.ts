/**
 * TennisStats.com Scraper — Premium Cookie Mode
 *
 * Scrapes homepage daily matches + H2H detail pages using Premium account cookies.
 * Extracts: Full Stats, Match History, Win %, Aces, Games, Breaks, DFs, Tiebreaks.
 *
 * TennisStats uses a div-based layout (no HTML tables). Structure:
 *   div.widget-box-shadow > div.widget-header > h2 (section heading)
 *   div.data-table > div.data-table-row (data rows with 3-4 cell children)
 *   Tabbed sections use div.ui-toggle-target.active for visible content.
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
  // Win Percentage (Last 12 Months, All Surfaces)
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
  // Serve & Return Stats (Last 12 Months, All Surfaces)
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
  // Match Total Games (Last 12 Months, All Surfaces)
  p1AvgGamesPerSet: number;
  p2AvgGamesPerSet: number;
  avgGamesPerSet: number;
  gamesOver20_5Pct: number;
  gamesOver21_5Pct: number;
  gamesOver22_5Pct: number;
  gamesOver23_5Pct: number;
  gamesOver24_5Pct: number;
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

    const bodyText = await page.evaluate(() => document.body.textContent || '');
    if (bodyText.includes('Performing security verification') || bodyText.includes('Just a moment')) {
      console.error('[TennisStats] Cloudflare blocked request');
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

      // Extract tournament context from section headings
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

  // ─── H2H Detail Page ───────────────────────────────────────────────────

  async scrapeH2HWithCookies(h2hUrl: string, cookiesJson: string): Promise<H2HData | null> {
    const page = await this.newPageWithCookies(cookiesJson);

    try {
      await page.goto(h2hUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForSelector('.data-table-row', { timeout: 10000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      // Verify page loaded correctly (not blocked by Cloudflare)
      const pageText = await page.evaluate(() => document.body.textContent || '');
      if (pageText.includes('Performing security verification') || pageText.includes('Just a moment')) {
        await page.close();
        return null;
      }

      if (!pageText.toLowerCase().includes('head to head') &&
          !pageText.toLowerCase().includes('h2h') &&
          !pageText.toLowerCase().includes(' vs ')) {
        console.warn(`[H2H] Page has no H2H content: ${h2hUrl}`);
        await page.close();
        return null;
      }

      // TODO: Switch stat sections to "Last 12 Months" view.
      // Currently reads default "2026 Calendar Year" data. Multiple approaches tried:
      //   1. element.click() inside page.evaluate() — adds 'active' to tab button but content panel doesn't switch
      //   2. Puppeteer page.click() with real mouse events — same result, tab button active but content unchanged
      // The site likely uses a custom JS toggle mechanism that neither approach triggers.
      // Possible fixes to try later:
      //   - page.evaluate(() => { /* dispatch custom event */ })
      //   - Intercept and modify the page URL to request L12M data directly
      //   - Use the TennisStats API if one exists (check network tab)
      //   - Try clicking with page.$eval and dispatchEvent('mousedown') + dispatchEvent('mouseup')

      // Extract all data from the page
      const data = await page.evaluate((url: string) => {
        const parseNum = (s: string | null | undefined): number => {
          if (!s || s === 'N/A' || s === '-') return 0;
          return parseFloat(s.replace(/[^0-9.\-]/g, '')) || 0;
        };

        const parsePct = (s: string | null | undefined): number => {
          if (!s || s === 'N/A' || s === '-') return 0;
          const m = s.match(/([\d.]+)\s*%/);
          return m ? parseFloat(m[1]) : 0;
        };

        // Cell value extraction handles two HTML patterns:
        //   <span>3</span>(75.0%)  → span holds the numeric value
        //   38<span class="fs08e">%</span> → text node holds value, span is just "%"
        const getCellValue = (cell: Element): string => {
          const spans = cell.querySelectorAll(':scope > span');
          if (spans.length > 0) {
            const first = (spans[0].textContent || '').trim();
            if (/^[\d.\-]/.test(first) || first === 'N/A') return first;
          }
          return (cell.textContent || '').replace(/\s+/g, ' ').trim();
        };

        const getCellFullText = (cell: Element): string =>
          (cell.textContent || '').replace(/\s+/g, ' ').trim();

        // Build section map: h2 heading → array of parsed data rows
        type SectionRow = { label: string; p1: string; p2: string; total: string; p1Full: string; p2Full: string };
        const sectionMap = new Map<string, SectionRow[]>();

        document.querySelectorAll('h2').forEach(h2 => {
          const heading = (h2.textContent || '').trim();
          if (!heading || heading.length > 200) return;

          let widget: Element | null = h2;
          while (widget && !(widget.classList?.contains('widget-box-shadow') || widget.classList?.contains('widget-sidebar-ranking'))) {
            widget = widget.parentElement;
          }
          if (!widget) return;

          const activeTarget = widget.querySelector('.ui-toggle-target.active');
          const container = activeTarget || widget;
          const rows: SectionRow[] = [];

          container.querySelectorAll('.data-table').forEach(dt => {
            dt.querySelectorAll('.data-table-row').forEach(row => {
              const children = Array.from(row.children) as Element[];
              if (children.length < 2) return;

              const label = getCellFullText(children[0]);
              const p1 = children.length > 1 ? getCellValue(children[1]) : '';
              const p2 = children.length > 2 ? getCellValue(children[2]) : '';
              const total = children.length > 3 ? getCellValue(children[3]) : '';
              const p1Full = children.length > 1 ? getCellFullText(children[1]) : '';
              const p2Full = children.length > 2 ? getCellFullText(children[2]) : '';

              if (label) rows.push({ label, p1, p2, total, p1Full, p2Full });
            });
          });

          if (rows.length > 0) sectionMap.set(heading, rows);
        });

        // Lookup helpers
        const findValue = (headingKeyword: string, labelKeyword: string) => {
          const hk = headingKeyword.toLowerCase();
          const lk = labelKeyword.toLowerCase();
          for (const [heading, rows] of sectionMap.entries()) {
            if (!heading.toLowerCase().includes(hk)) continue;
            for (const row of rows) {
              if (row.label.toLowerCase().includes(lk)) return row;
            }
          }
          return { p1: '', p2: '', total: '', p1Full: '', p2Full: '' };
        };

        const getFirstRow = (headingKeyword: string) => {
          const hk = headingKeyword.toLowerCase();
          for (const [heading, rows] of sectionMap.entries()) {
            if (!heading.toLowerCase().includes(hk)) continue;
            if (rows.length > 0) return rows[0];
          }
          return { p1: '', p2: '', total: '', p1Full: '', p2Full: '', label: '' };
        };

        // Extract player names from H1
        const h1 = document.querySelector('h1')?.textContent || '';
        const vsMatch = h1.match(/(.+?)\s+vs\.?\s+(.+?)(?:\s+Head|\s+H2H|\s+Stats|\s*$)/i);
        if (!vsMatch) return null;

        const player1 = vsMatch[1].trim();
        const player2 = vsMatch[2].trim();
        const urlSlug = url.match(/\/h2h\/(.+?)$/);
        const h2hKey = urlSlug ? urlSlug[1] : `${player1}-vs-${player2}`;

        // Full Stats section
        const rankRow = findValue('Full Stats', 'Current Rank');
        const winsRow = findValue('Full Stats', 'Wins');
        const setsRow = findValue('Full Stats', 'Sets Won');
        const cyRow = findValue('Full Stats', 'Win Percentage') || findValue('Full Stats', 'Calendar Year');
        const l12mRow = findValue('Full Stats', 'Last 12') || findValue('Full Stats', '12 Month');

        // Match History (h2h-history-row elements)
        // Filter to valid H2H entries only (score format "X-Y" with a winner)
        const matchHistory: Array<{ date: string; tournament: string; surface: string; winner: string; score: string }> = [];
        document.querySelectorAll('.h2h-history-row').forEach(row => {
          const children = Array.from(row.children) as Element[];
          if (children.length < 5) return;

          const dateHTML = children[0].innerHTML;
          const dateParts = dateHTML.split(/<br\s*\/?>/i);
          const dateStr = dateParts.map(p => p.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join(' ');
          if (!dateStr) return;

          const tourneyHTML = children[1].innerHTML;
          const tourneyParts = tourneyHTML.split(/<br\s*\/?>/i);
          const tournament = tourneyParts[0] ? tourneyParts[0].replace(/<[^>]+>/g, '').trim() : '';
          let surface = 'Hard';
          if (tourneyParts.length > 1) {
            const surfaceText = tourneyParts.slice(1).join(' ').replace(/<[^>]+>/g, '').trim().toLowerCase();
            if (surfaceText.includes('clay')) surface = 'Clay';
            else if (surfaceText.includes('grass')) surface = 'Grass';
          }

          const scoreEl = children[3];
          const scoreSpans = scoreEl.querySelectorAll('span');
          let score = '';
          if (scoreSpans.length >= 2) {
            score = (scoreSpans[0].textContent || '').trim() + '-' + (scoreSpans[1].textContent || '').trim();
          } else {
            const raw = (scoreEl.textContent || '').replace(/\s+/g, '').trim();
            if (raw.length === 2 && /^\d{2}$/.test(raw)) {
              score = raw[0] + '-' + raw[1];
            } else {
              score = raw;
            }
          }

          let winner = '';
          if (children[2]?.classList?.contains('winner')) {
            winner = (children[2].textContent || '').replace(/\s+/g, ' ').trim();
          } else if (children[4]?.classList?.contains('winner')) {
            winner = (children[4].textContent || '').replace(/\s+/g, ' ').trim();
          }

          // Only include valid H2H entries (proper score + identified winner)
          if (/^\d+-\d+$/.test(score) && winner) {
            matchHistory.push({ date: dateStr, tournament, surface, winner, score });
          }
        });

        // Stat sections — first row from each
        const winPctRow = getFirstRow('Win Percentage');
        const acesRow = getFirstRow('Aces');
        const dfRow = getFirstRow('Double Faults');
        const brRow = getFirstRow('Break');
        const tbRow = getFirstRow('Tie Break');
        const gamesRow = getFirstRow('Match Total Games');

        return {
          h2hKey,
          player1,
          player2,
          p1Rank: parseNum(rankRow.p1),
          p2Rank: parseNum(rankRow.p2),
          p1H2HWins: parseNum(winsRow.p1),
          p2H2HWins: parseNum(winsRow.p2),
          p1H2HSets: parseNum(setsRow.p1),
          p2H2HSets: parseNum(setsRow.p2),
          p1CalendarYearWinPct: parsePct(cyRow.p1Full || cyRow.p1),
          p1CalendarYearRecord: cyRow.p1Full || cyRow.p1 || '',
          p2CalendarYearWinPct: parsePct(cyRow.p2Full || cyRow.p2),
          p2CalendarYearRecord: cyRow.p2Full || cyRow.p2 || '',
          p1Last12mWinPct: parsePct(l12mRow.p1Full || l12mRow.p1),
          p1Last12mRecord: l12mRow.p1Full || l12mRow.p1 || '',
          p2Last12mWinPct: parsePct(l12mRow.p2Full || l12mRow.p2),
          p2Last12mRecord: l12mRow.p2Full || l12mRow.p2 || '',
          matchHistory,
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
          p1AcesPerMatch: parseNum(acesRow.p1),
          p2AcesPerMatch: parseNum(acesRow.p2),
          acesMatchTotal: parseNum(acesRow.total),
          p1DoubleFaultsPerMatch: parseNum(dfRow.p1),
          p2DoubleFaultsPerMatch: parseNum(dfRow.p2),
          doubleFaultsMatchTotal: parseNum(dfRow.total),
          p1BreaksPerMatch: parseNum(brRow.p1),
          p2BreaksPerMatch: parseNum(brRow.p2),
          breaksMatchTotal: parseNum(brRow.total),
          p1TiebreaksPerMatch: parseNum(tbRow.p1),
          p2TiebreaksPerMatch: parseNum(tbRow.p2),
          tiebreaksAverage: parseNum(tbRow.total),
          p1AvgGamesPerSet: parseNum(gamesRow.p1),
          p2AvgGamesPerSet: parseNum(gamesRow.p2),
          avgGamesPerSet: parseNum(gamesRow.total),
          gamesOver20_5Pct: 0,
          gamesOver21_5Pct: 0,
          gamesOver22_5Pct: 0,
          gamesOver23_5Pct: 0,
          gamesOver24_5Pct: 0,
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
