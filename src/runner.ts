/**
 * TennisStats Scraper Runner — Account Rotation Edition
 * 
 * Flow:
 * ┌────────────────────────────────────────────────────────────────┐
 * │  1. Scrape homepage (FREE) → all matches + form/odds/rankings │
 * │                                                                │
 * │  2. Check H2H cache → skip matches we already have data for   │
 * │                                                                │
 * │  3. Prioritize remaining matches by betting value potential    │
 * │     (close odds, form vs odds disagreement, top-ranked, etc.) │
 * │                                                                │
 * │  4. Load account pool → check available views today            │
 * │     10 accounts × 3 views = 30 detail pages                   │
 * │                                                                │
 * │  5. For each high-priority match (until views exhausted):     │
 * │     a. Pick next account with remaining views                  │
 * │     b. Login or restore session cookies                        │
 * │     c. Scrape H2H detail page (1 view)                        │
 * │     d. If limit hit → mark account exhausted, rotate to next  │
 * │     e. Cache result in Supabase                               │
 * │                                                                │
 * │  6. Store everything → ready for 6 AM prediction pipeline     │
 * └────────────────────────────────────────────────────────────────┘
 */

import TennisStatsScraper, { DailyMatch } from './scraper';
import SessionScraper from './session-scraper';
import TennisStatsDB from './database';
import { AccountPool, ViewAllocator } from './account-pool';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const DELAY_MS = 2500; // Slightly longer delay between account-gated requests
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  TennisStats Scraper — Account Rotation Mode');
  console.log(`  ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════\n');

  const freeScraper = new TennisStatsScraper();
  const sessionScraper = new SessionScraper();
  const db = new TennisStatsDB(SUPABASE_URL, SUPABASE_KEY);
  const pool = new AccountPool(SUPABASE_URL, SUPABASE_KEY);
  const allocator = new ViewAllocator(SUPABASE_URL, SUPABASE_KEY);

  const stats = { 
    matchesFound: 0,
    freeDataSaved: 0,
    detailViewsUsed: 0,
    detailViewsCached: 0,
    accountsExhausted: 0,
    errors: 0,
  };

  try {
    await freeScraper.init();
    await sessionScraper.init();
    await pool.loadAccounts();

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 1: FREE homepage scrape (unlimited, no login needed)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n📅 Phase 1: Scraping homepage (FREE, unlimited)...');
    
    const allMatches = await freeScraper.scrapeDailyMatches();
    const singlesMatches = allMatches.filter((m) => m.category === 'Singles');
    stats.matchesFound = singlesMatches.length;
    
    console.log(`   Found ${allMatches.length} total, ${singlesMatches.length} singles`);

    // Save all homepage data to DB (form scores, odds, rankings — all free)
    const today = new Date().toISOString().split('T')[0];
    await db.upsertDailyMatches(singlesMatches, today);
    stats.freeDataSaved = singlesMatches.length;
    console.log(`   ✓ Saved ${singlesMatches.length} matches with free data`);

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 2: Smart allocation — which matches deserve detail views?
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n🧠 Phase 2: Allocating detail views...');

    const availableViews = pool.getTotalAvailableViews();
    console.log(`   Available views today: ${availableViews}`);

    if (availableViews === 0) {
      console.log('   ⚠ No views available! All accounts exhausted for today.');
      console.log('   Homepage data was still saved — predictions can use form/odds/rankings.');
      return;
    }

    const allocations = await allocator.allocateViews(singlesMatches, availableViews);

    // Filter to only matches worth scraping (positive priority, upcoming)
    const worthScraping = allocations.filter((a) => a.priority > 20);
    console.log(`   ${worthScraping.length} matches worth detailed scraping`);
    console.log(`   Top priorities:`);
    worthScraping.slice(0, 5).forEach((a, i) => {
      console.log(`     ${i + 1}. [${a.priority}pts] ${a.matchH2hPath} — ${a.reason}`);
    });

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 3: Scrape detail pages using account rotation
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n🔄 Phase 3: Scraping details with account rotation...');

    let currentAccount = pool.getNextAvailableAccount();
    let currentCookies: string | null = null;

    for (const allocation of worthScraping) {
      // Check if we have any accounts left
      if (!currentAccount) {
        console.log('   ⚠ All accounts exhausted. Stopping detail scraping.');
        break;
      }

      // Login or restore session for current account
      if (!currentCookies) {
        try {
          if (currentAccount.cookies) {
            currentCookies = currentAccount.cookies;
            console.log(`   Using cached session for ${currentAccount.credentials.username}...`);
          } else {
            currentCookies = await sessionScraper.login(
              currentAccount.credentials.username,
              currentAccount.credentials.password
            );
            await pool.saveCookies(currentAccount.credentials.id, currentCookies);
          }
        } catch (err: any) {
          console.error(`   ✗ Login failed: ${err.message}`);
          stats.errors++;
          // Try next account
          currentAccount = pool.getNextAvailableAccount();
          currentCookies = null;
          continue;
        }
      }

      // Scrape the H2H detail page
      try {
        console.log(`   Scraping H2H: ${allocation.matchH2hPath}...`);
        const result = await sessionScraper.scrapeH2HWithSession(
          allocation.matchH2hPath,
          currentCookies!
        );

        if (result.hitLimit) {
          // This account is done for today
          console.log(`   ⚠ Account ${currentAccount.credentials.username}... hit view limit`);
          stats.accountsExhausted++;

          // Force max views so we don't try this account again
          await pool.consumeView(currentAccount.credentials.id);
          await pool.consumeView(currentAccount.credentials.id);
          await pool.consumeView(currentAccount.credentials.id);

          // Rotate to next account
          currentAccount = pool.getNextAvailableAccount();
          currentCookies = null;

          // Retry this same match with the new account
          if (currentAccount) {
            console.log(`   ↻ Rotating to next account...`);
            // Don't continue — let the loop try again with the next account
            // We push this allocation back by not incrementing
          }
          continue;
        }

        if (result.data) {
          await db.upsertH2H(result.data, allocation.matchH2hPath);
          await pool.consumeView(currentAccount.credentials.id);
          stats.detailViewsUsed++;
          
          const record = `${result.data.h2hRecord.player1Wins}-${result.data.h2hRecord.player2Wins}`;
          console.log(`   ✓ ${result.data.player1} vs ${result.data.player2} (${record})`);
        }
      } catch (err: any) {
        console.error(`   ✗ Error scraping ${allocation.matchH2hPath}: ${err.message}`);
        stats.errors++;
      }

      // Check if current account is exhausted after this view
      if (currentAccount && currentAccount.viewsUsedToday >= currentAccount.maxViews) {
        console.log(`   Account ${currentAccount.credentials.username}... views exhausted`);
        stats.accountsExhausted++;
        currentAccount = pool.getNextAvailableAccount();
        currentCookies = null;
      }

      await sleep(DELAY_MS);
    }

    // ═══════════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  Scraping Complete!');
    console.log(`  Matches found:         ${stats.matchesFound}`);
    console.log(`  Free data saved:       ${stats.freeDataSaved} (form, odds, rankings)`);
    console.log(`  Detail views used:     ${stats.detailViewsUsed}`);
    console.log(`  Accounts exhausted:    ${stats.accountsExhausted}`);
    console.log(`  Views remaining:       ${pool.getTotalAvailableViews()}`);
    console.log(`  Errors:                ${stats.errors}`);
    console.log('═══════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  } finally {
    await freeScraper.close();
    await sessionScraper.close();
  }
}

run().catch(console.error);
