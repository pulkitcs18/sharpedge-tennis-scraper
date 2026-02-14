/**
 * TennisStats Scraper — Premium Cookie Mode
 * 
 * Uses manually exported browser cookies from one Premium account
 * to scrape all match data including H2H and player stats.
 * 
 * No login needed — cookies are stored in Supabase.
 * Re-export cookies every 1-2 weeks when they expire.
 */

import TennisStatsScraper from './scraper';
import TennisStatsDB from './database';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const DELAY_MS = 2500; // Delay between detail page requests

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  TennisStats Scraper — Premium Cookie Mode');
  console.log('  ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════\n');

  const scraper = new TennisStatsScraper();
  const db = new TennisStatsDB(SUPABASE_URL, SUPABASE_KEY);

  try {
    await scraper.init();

    // ── Step 1: Load cookies from Supabase ──────────────────────
    console.log('🔑 Loading Premium account cookies...');
    const account = await db.getActiveAccount();
    
    if (!account || !account.session_cookies) {
      console.error('❌ No cookies found! Please export cookies from your browser.');
      console.error('   See README for instructions.');
      process.exit(1);
    }
    
    console.log('   ✓ Loaded cookies for: ' + account.username);

    // ── Step 2: Scrape homepage (FREE, no cookies needed) ───────
    console.log('\n📅 Phase 1: Scraping homepage...');
    const allMatches = await scraper.scrapeDailyMatches(undefined, account.session_cookies);
    const singlesMatches = allMatches.filter((m) => m.category === 'Singles');

    console.log('   Found ' + allMatches.length + ' total, ' + singlesMatches.length + ' singles');

    const today = new Date().toISOString().split('T')[0];
    await db.upsertDailyMatches(singlesMatches, today);
    console.log('   ✓ Saved ' + singlesMatches.length + ' matches');

    // ── Step 3: Scrape H2H detail pages (Premium, needs cookies) ─
    const upcoming = singlesMatches.filter(m => m.status === 'upcoming' && m.h2hUrl);
    console.log('\n🔍 Phase 2: Scraping ' + upcoming.length + ' H2H detail pages...');
    
    let successCount = 0;
    let errorCount = 0;
    let cookieExpired = false;

    for (let i = 0; i < upcoming.length; i++) {
      const match = upcoming[i];
      const shortName = match.player1.name.split(' ').pop() + ' vs ' + match.player2.name.split(' ').pop();
      
      try {
        const h2hData = await scraper.scrapeH2HWithCookies(
          match.h2hUrl,
          account.session_cookies
        );

        if (h2hData === null) {
          console.log('   ⚠ [' + (i + 1) + '/' + upcoming.length + '] ' + shortName + ' — no data or cookies expired');
          errorCount++;
          
          // If first few requests all fail, cookies are likely expired
          if (i < 3 && errorCount >= 3) {
            console.error('\n❌ Cookies appear expired! Please re-export from browser.');
            cookieExpired = true;
            break;
          }
        } else {
          // Save H2H data
          await db.upsertH2H(h2hData);
          
          // Save player stats if available
          if (h2hData.player1Stats) {
            await db.upsertPlayer(h2hData.player1Stats);
          }
          if (h2hData.player2Stats) {
            await db.upsertPlayer(h2hData.player2Stats);
          }

          console.log('   ✓ [' + (i + 1) + '/' + upcoming.length + '] ' + shortName + 
            ' (H2H: ' + h2hData.h2hRecord.player1Wins + '-' + h2hData.h2hRecord.player2Wins + ')');
          successCount++;
        }
      } catch (err: any) {
        console.log('   ✗ [' + (i + 1) + '/' + upcoming.length + '] ' + shortName + ' — ' + (err.message || err));
        errorCount++;
      }

      // Rate limit
      if (i < upcoming.length - 1) {
        await sleep(DELAY_MS);
      }
    }

    // ── Summary ──────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  Scraping Complete!');
    console.log('  Singles matches:     ' + singlesMatches.length);
    console.log('  H2H pages scraped:   ' + successCount);
    console.log('  Errors:              ' + errorCount);
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
