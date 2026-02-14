/**
 * TennisStats Scraper — Premium Cookie Mode v2
 * 
 * Features:
 * - Tournament filter (only Grand Slams, Masters 1000, ATP/WTA 500+)
 * - Comprehensive H2H extraction (all stats tables)
 * - Past 7 days homepage scraping for tournament path
 * - Cookie-based Cloudflare bypass
 */

import TennisStatsScraper from './scraper';
import TennisStatsDB from './database';
import { filterSupportedMatches } from './tournaments';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

const DELAY_MS = 3000; // Delay between H2H page requests
const DAYS_BACK = 0;   // How many past days to scrape for tournament path

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function getDateString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function run() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  TennisStats Scraper v2 — Premium Cookie Mode');
  console.log('  ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════\n');

  const scraper = new TennisStatsScraper();
  const db = new TennisStatsDB(SUPABASE_URL, SUPABASE_KEY);

  try {
    await scraper.init();

    // ── Step 1: Load cookies ────────────────────────────────────
    console.log('🔑 Loading Premium account cookies...');
    const account = await db.getActiveAccount();

    if (!account || !account.session_cookies) {
      console.error('❌ No cookies found! Please export cookies from your browser.');
      process.exit(1);
    }
    console.log('   ✓ Loaded cookies for: ' + account.username);

    // ── Step 2: Scrape today's homepage ─────────────────────────
    console.log('\n📅 Phase 1: Scraping today\'s matches...');
    const allMatches = await scraper.scrapeDailyMatches(undefined, account.session_cookies);

    // Filter to singles only
    const singlesMatches = allMatches.filter(m => m.category === 'Singles');
    console.log('   Total: ' + allMatches.length + ' matches, ' + singlesMatches.length + ' singles');

    // Filter to supported tournaments only
    const supportedMatches = filterSupportedMatches(singlesMatches);
    console.log('   Supported tournaments: ' + supportedMatches.length + ' matches');

    const today = getDateString(0);
    await db.upsertDailyMatches(supportedMatches, today);
    console.log('   ✓ Saved ' + supportedMatches.length + ' matches for ' + today);

    // ── Step 3: Scrape past days for tournament path ────────────
    console.log('\n📆 Phase 2: Scraping past ' + DAYS_BACK + ' days for tournament path...');

    for (let i = 1; i <= DAYS_BACK; i++) {
      const pastDate = getDateString(i);

      // Check if we already have data for this date
      const alreadyScraped = await db.hasMatchesForDate(pastDate);

      if (alreadyScraped) {
        console.log('   ⏭ ' + pastDate + ' — already scraped');
        continue;
      }

      const pastMatches = await scraper.scrapeDailyMatches(pastDate, account.session_cookies);
      const pastSingles = pastMatches.filter(m => m.category === 'Singles');
      const pastSupported = filterSupportedMatches(pastSingles);

      if (pastSupported.length > 0) {
        await db.upsertDailyMatches(pastSupported, pastDate);
        console.log('   ✓ ' + pastDate + ' — ' + pastSupported.length + ' matches saved');
      } else {
        console.log('   · ' + pastDate + ' — no supported matches');
      }

      await sleep(2000);
    }

    // ── Step 4: Scrape H2H detail pages ─────────────────────────
    const upcoming = supportedMatches.filter(m => m.status === 'upcoming' && m.h2hUrl);
    console.log('\n🔍 Phase 3: Scraping ' + upcoming.length + ' H2H detail pages...');

    let successCount = 0;
    let errorCount = 0;
    let cookieExpired = false;

    for (let i = 0; i < upcoming.length; i++) {
      const match = upcoming[i];
      const shortName = match.player1.name.split(' ').pop() + ' vs ' + match.player2.name.split(' ').pop();
      const tournamentLabel = match.tournamentOfficialName || match.tournament;

      try {
        const h2hData = await scraper.scrapeH2HWithCookies(
          match.h2hUrl,
          account.session_cookies
        );

        if (h2hData === null) {
          console.log('   ⚠ [' + (i + 1) + '/' + upcoming.length + '] ' + shortName + ' — no data');
          errorCount++;

          if (i < 3 && errorCount >= 3) {
            console.error('\n❌ Cookies appear expired! Please re-export from browser.');
            cookieExpired = true;
            break;
          }
        } else {
          await db.upsertH2H(h2hData);

          // Log key stats
          const statsFound = [
            h2hData.p1H2HWins + h2hData.p2H2HWins > 0 ? 'H2H' : '',
            h2hData.p1MatchWinsPct > 0 ? 'Win%' : '',
            h2hData.p1AcesPerMatch > 0 ? 'Aces' : '',
            h2hData.p1BreaksPerMatch > 0 ? 'Breaks' : '',
            h2hData.p1AvgGamesPerSet > 0 ? 'Games' : '',
            h2hData.p1DoubleFaultsPerMatch > 0 ? 'DFs' : '',
            h2hData.p1TiebreaksPerMatch > 0 ? 'TBs' : '',
            h2hData.matchHistory.length > 0 ? 'History(' + h2hData.matchHistory.length + ')' : '',
          ].filter(Boolean).join(', ');

          console.log('   ✓ [' + (i + 1) + '/' + upcoming.length + '] ' + shortName +
            ' | ' + tournamentLabel +
            ' | H2H: ' + h2hData.p1H2HWins + '-' + h2hData.p2H2HWins +
            ' | Data: ' + statsFound);
          successCount++;
        }
      } catch (err: any) {
        console.log('   ✗ [' + (i + 1) + '/' + upcoming.length + '] ' + shortName + ' — ' + (err.message || err));
        errorCount++;
      }

      if (i < upcoming.length - 1) {
        await sleep(DELAY_MS);
      }
    }

    // ── Summary ──────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  Scraping Complete!');
    console.log('  Today\'s matches:     ' + supportedMatches.length + ' (from supported tournaments)');
    console.log('  H2H pages scraped:   ' + successCount);
    console.log('  H2H errors:          ' + errorCount);
    if (cookieExpired) {
      console.log('  ⚠ COOKIES EXPIRED — re-export from browser!');
    }
    console.log('═══════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  } finally {
    await scraper.close();
  }
}

run().catch(console.error);
