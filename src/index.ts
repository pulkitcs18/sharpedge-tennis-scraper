/**
 * TennisStats Scraper Runner
 * 
 * Orchestrates the full scraping pipeline:
 * 1. Scrape today's matches → get player list
 * 2. Scrape player stats for each player in today's matches
 * 3. Scrape H2H data for each matchup
 * 4. Store everything in Supabase
 * 
 * Designed to run as a scheduled job alongside existing 6 AM prediction pipeline
 * Can run on Railway using existing Puppeteer setup
 */

import TennisStatsScraper from './scraper';
import TennisStatsDB from './database';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// Rate limiting: delay between requests to be respectful
const DELAY_MS = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log('═══════════════════════════════════════════════');
  console.log('  TennisStats Scraper for SharpEdge');
  console.log(`  ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════\n');

  const scraper = new TennisStatsScraper();
  const db = new TennisStatsDB(SUPABASE_URL, SUPABASE_KEY);
  
  try {
    await scraper.init();

    // ── Step 1: Scrape today's matches ──────────────────────────────────
    console.log('\n📅 Step 1: Scraping today\'s matches...');
    const todayMatches = await scraper.scrapeDailyMatches();
    console.log(`   Found ${todayMatches.length} matches`);

    // Filter to singles only for initial prediction model
    const singlesMatches = todayMatches.filter((m) => m.category === 'Singles');
    console.log(`   ${singlesMatches.length} singles matches`);

    const today = new Date().toISOString().split('T')[0];
    await db.upsertDailyMatches(singlesMatches, today);

    // ── Step 2: Collect unique players and scrape their stats ────────────
    console.log('\n👤 Step 2: Scraping player stats...');
    const playerSlugs = new Set<string>();

    for (const match of singlesMatches) {
      // Extract player slugs from the H2H URL
      const slugs = scraper.extractPlayerSlug(match.h2hUrl);
      if (slugs) {
        playerSlugs.add(slugs.player1Slug);
        playerSlugs.add(slugs.player2Slug);
      }
    }

    console.log(`   ${playerSlugs.size} unique players to scrape`);
    let playerCount = 0;

    for (const slug of playerSlugs) {
      try {
        const stats = await scraper.scrapePlayerStats(slug);
        if (stats) {
          await db.upsertPlayerStats(stats);
          playerCount++;
          console.log(`   ✓ ${stats.name} (${stats.ranking}) - ${stats.trailing12MonthsWinPct}% win rate`);
        }
      } catch (err: any) {
        console.error(`   ✗ Failed to scrape ${slug}: ${err.message}`);
      }
      await sleep(DELAY_MS);
    }

    console.log(`   Scraped ${playerCount}/${playerSlugs.size} players`);

    // ── Step 3: Scrape H2H for each matchup ─────────────────────────────
    console.log('\n🆚 Step 3: Scraping H2H data...');
    let h2hCount = 0;

    for (const match of singlesMatches) {
      if (!match.h2hUrl) continue;
      
      try {
        // Extract path from full URL
        const urlPath = new URL(match.h2hUrl).pathname.replace('/h2h/', '');
        const h2h = await scraper.scrapeH2H(match.h2hUrl);
        if (h2h) {
          await db.upsertH2H(h2h, urlPath);
          h2hCount++;
          const record = `${h2h.h2hRecord.player1Wins}-${h2h.h2hRecord.player2Wins}`;
          console.log(`   ✓ ${h2h.player1} vs ${h2h.player2} (${record})`);
        }
      } catch (err: any) {
        console.error(`   ✗ Failed H2H: ${err.message}`);
      }
      await sleep(DELAY_MS);
    }

    console.log(`   Scraped ${h2hCount} H2H records`);

    // ── Summary ─────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════');
    console.log('  Scraping Complete!');
    console.log(`  Matches: ${singlesMatches.length}`);
    console.log(`  Players: ${playerCount}`);
    console.log(`  H2H Records: ${h2hCount}`);
    console.log('═══════════════════════════════════════════════\n');

  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  } finally {
    await scraper.close();
  }
}

// Also export for use as a module in your Edge Function
export { run as scrapeTennisStats };

// Run if called directly
run().catch(console.error);
