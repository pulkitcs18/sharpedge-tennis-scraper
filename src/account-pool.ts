/**
 * TennisStats Account Pool & Smart View Allocator
 * 
 * Problem: Free tier = 3 detailed match views per account per day
 * Solution: Pool of accounts + smart prioritization of which matches
 *           deserve a detailed scrape vs. homepage-only data
 * 
 * Architecture:
 * ┌──────────────────────────────────────────────────────┐
 * │  1. Scrape homepage (FREE, unlimited, no login)      │
 * │     → Gets: form scores, odds, rankings, surface     │
 * │     → For ALL matches                                │
 * │                                                       │
 * │  2. Prioritize which matches need detailed data      │
 * │     → Rank by: confidence gap, odds value, ranking   │
 * │                                                       │
 * │  3. Allocate account views to top-priority matches   │
 * │     → 10 accounts × 3 views = 30 detailed scrapes   │
 * │     → Each account gets assigned specific matches    │
 * │                                                       │
 * │  4. Scrape H2H + player pages using allocated accts  │
 * │     → Cache results so we never waste a view twice   │
 * └──────────────────────────────────────────────────────┘
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Page, Browser } from 'puppeteer';
import type { DailyMatch } from './scraper';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AccountCredentials {
  id: string;
  username: string;
  password: string;
}

interface AccountState {
  credentials: AccountCredentials;
  viewsUsedToday: number;
  maxViews: number;
  lastResetDate: string; // YYYY-MM-DD
  cookies: string | null; // Serialized session cookies
}

interface ViewAllocation {
  matchH2hPath: string;
  player1Slug: string;
  player2Slug: string;
  priority: number;
  assignedAccountId: string | null;
  reason: string;
}

// ─── Account Pool Manager ────────────────────────────────────────────────────

export class AccountPool {
  private accounts: AccountState[] = [];
  private supabase: SupabaseClient;
  private VIEWS_PER_ACCOUNT = 3;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Load accounts from Supabase (encrypted credentials stored in DB)
   * Table: tennisstats_accounts
   */
  async loadAccounts(): Promise<void> {
    const { data, error } = await this.supabase
      .from('tennisstats_accounts')
      .select('*')
      .eq('is_active', true);

    if (error) throw new Error(`Failed to load accounts: ${error.message}`);

    const today = new Date().toISOString().split('T')[0];

    this.accounts = (data || []).map((row) => ({
      credentials: {
        id: row.id,
        username: row.username,
        password: row.password,
      },
      // Reset view count if it's a new day
      viewsUsedToday: row.last_reset_date === today ? row.views_used_today : 0,
      maxViews: this.VIEWS_PER_ACCOUNT,
      lastResetDate: today,
      cookies: row.session_cookies,
    }));

    console.log(`[Pool] Loaded ${this.accounts.length} accounts`);
    console.log(`[Pool] Total available views: ${this.getTotalAvailableViews()}`);
  }

  /**
   * How many detail views can we make today?
   */
  getTotalAvailableViews(): number {
    return this.accounts.reduce(
      (sum, acc) => sum + (acc.maxViews - acc.viewsUsedToday),
      0
    );
  }

  /**
   * Get the next account that still has views remaining
   */
  getNextAvailableAccount(): AccountState | null {
    return (
      this.accounts.find((acc) => acc.viewsUsedToday < acc.maxViews) || null
    );
  }

  /**
   * Mark that an account used one of its views
   */
  async consumeView(accountId: string): Promise<void> {
    const account = this.accounts.find(
      (a) => a.credentials.id === accountId
    );
    if (!account) return;

    account.viewsUsedToday++;

    // Persist to DB
    await this.supabase
      .from('tennisstats_accounts')
      .update({
        views_used_today: account.viewsUsedToday,
        last_reset_date: account.lastResetDate,
      })
      .eq('id', accountId);
  }

  /**
   * Save session cookies so we don't have to re-login every time
   */
  async saveCookies(accountId: string, cookies: string): Promise<void> {
    const account = this.accounts.find(
      (a) => a.credentials.id === accountId
    );
    if (account) account.cookies = cookies;

    await this.supabase
      .from('tennisstats_accounts')
      .update({ session_cookies: cookies })
      .eq('id', accountId);
  }

  getAccounts(): AccountState[] {
    return this.accounts;
  }
}

// ─── Smart View Allocator ────────────────────────────────────────────────────
// Decides WHICH matches are worth using our limited detail views on

export class ViewAllocator {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Given today's matches and available views, decide which matches
   * get detailed scraping and which rely on homepage-only data.
   * 
   * Priority scoring:
   * - Higher-ranked players = more data value
   * - Close odds (toss-up matches) = more prediction edge needed
   * - No cached H2H data = needs fresh scrape
   * - ATP/WTA main tour > Challengers/ITF
   */
  async allocateViews(
    matches: DailyMatch[],
    availableViews: number
  ): Promise<ViewAllocation[]> {
    const allocations: ViewAllocation[] = [];

    for (const match of matches) {
      const priority = await this.calculatePriority(match);
      const h2hPath = this.extractH2HPath(match.h2hUrl);

      allocations.push({
        matchH2hPath: h2hPath,
        player1Slug: this.nameToSlug(match.player1.name),
        player2Slug: this.nameToSlug(match.player2.name),
        priority,
        assignedAccountId: null,
        reason: this.getPriorityReason(match, priority),
      });
    }

    // Sort by priority (highest first)
    allocations.sort((a, b) => b.priority - a.priority);

    // Only the top N matches get detailed views
    // Each match needs up to 3 views: H2H page + 2 player pages
    // But we can be smarter — check cache first
    const viewsNeeded = await this.calculateViewsNeeded(allocations);
    
    console.log(`[Allocator] ${matches.length} matches, ${availableViews} views available`);
    console.log(`[Allocator] ${viewsNeeded.uncachedCount} matches need fresh data`);
    console.log(`[Allocator] Allocating views to top ${Math.min(availableViews, viewsNeeded.uncachedCount)} matches`);

    return allocations;
  }

  private async calculatePriority(match: DailyMatch): Promise<number> {
    let score = 0;

    // ── Tier bonus (main tour vs challenger) ──
    const tournament = match.tournament.toLowerCase();
    if (tournament.includes('atp') || tournament.includes('wta')) {
      if (!tournament.includes('chall')) {
        score += 40; // Main tour event
      } else {
        score += 15; // Challenger
      }
    } else if (tournament.includes('itf')) {
      score += 5; // ITF / lower level
    } else {
      score += 20; // Default
    }

    // ── Ranking bonus (higher-ranked = more valuable data) ──
    const bestRanking = Math.min(
      match.player1.ranking || 999,
      match.player2.ranking || 999
    );
    if (bestRanking <= 10) score += 30;
    else if (bestRanking <= 30) score += 20;
    else if (bestRanking <= 50) score += 15;
    else if (bestRanking <= 100) score += 10;

    // ── Close odds bonus (toss-up = more edge potential) ──
    if (match.player1.odds && match.player2.odds) {
      const oddsDiff = Math.abs(match.player1.odds - match.player2.odds);
      if (oddsDiff < 0.5) score += 25;      // Very close
      else if (oddsDiff < 1.0) score += 15;  // Moderately close
      else if (oddsDiff < 2.0) score += 5;   // Clear favorite
      // Heavy favorite = low priority (less edge potential)
    }

    // ── Form score variance bonus ──
    // When form scores disagree with odds, there's a potential edge
    if (match.player1.odds && match.player2.odds) {
      const formFavorsP1 = match.player1.formScore > match.player2.formScore;
      const oddsFavorP1 = match.player1.odds < match.player2.odds;
      if (formFavorsP1 !== oddsFavorP1) {
        score += 20; // Form disagrees with odds — interesting match!
      }
    }

    // ── Cache miss bonus (no existing H2H data = needs scrape) ──
    const h2hPath = this.extractH2HPath(match.h2hUrl);
    const { data: cached } = await this.supabase
      .from('tennis_h2h')
      .select('updated_at')
      .eq('h2h_key', h2hPath)
      .single();

    if (!cached) {
      score += 15; // Never scraped this matchup
    } else {
      const daysSinceUpdate = this.daysSince(cached.updated_at);
      if (daysSinceUpdate > 30) score += 10; // Stale data
      else score -= 20; // Fresh cache, skip this one
    }

    // ── Upcoming match bonus (only scrape matches that haven't happened) ──
    if (match.status === 'upcoming') score += 10;
    if (match.status === 'finished') score -= 50; // Don't waste views on finished matches

    return Math.max(0, score);
  }

  private async calculateViewsNeeded(
    allocations: ViewAllocation[]
  ): Promise<{ uncachedCount: number }> {
    let uncachedCount = 0;

    for (const alloc of allocations) {
      // Check if we already have recent H2H data
      const { data } = await this.supabase
        .from('tennis_h2h')
        .select('updated_at')
        .eq('h2h_key', alloc.matchH2hPath)
        .single();

      if (!data || this.daysSince(data.updated_at) > 7) {
        uncachedCount++;
      }
    }

    return { uncachedCount };
  }

  private getPriorityReason(match: DailyMatch, score: number): string {
    const reasons: string[] = [];
    if (score >= 80) reasons.push('High-value main tour match');
    if (match.player1.odds && match.player2.odds) {
      const diff = Math.abs(match.player1.odds - match.player2.odds);
      if (diff < 0.5) reasons.push('Toss-up odds');
    }
    const formFavorsP1 = match.player1.formScore > match.player2.formScore;
    const oddsFavorP1 = (match.player1.odds || 99) < (match.player2.odds || 99);
    if (formFavorsP1 !== oddsFavorP1) reasons.push('Form vs odds disagreement');
    return reasons.join(', ') || 'Standard priority';
  }

  private extractH2HPath(url: string): string {
    try {
      return new URL(url).pathname.replace('/h2h/', '');
    } catch {
      return url.replace(/.*\/h2h\//, '');
    }
  }

  private nameToSlug(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  private daysSince(dateStr: string): number {
    const then = new Date(dateStr).getTime();
    const now = Date.now();
    return (now - then) / (1000 * 60 * 60 * 24);
  }
}
