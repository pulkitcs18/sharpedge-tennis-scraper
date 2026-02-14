/**
 * Supabase Database Layer for TennisStats Scraper
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DailyMatch, H2HData, PlayerStats } from './scraper';

export class TennisStatsDB {
  private supabase: SupabaseClient;

  constructor(url: string, key: string) {
    this.supabase = createClient(url, key);
  }

  // ─── Account / Cookies ─────────────────────────────────────────────────

  async getActiveAccount(): Promise<{ username: string; session_cookies: string } | null> {
    const { data, error } = await this.supabase
      .from('tennisstats_accounts')
      .select('username, session_cookies')
      .eq('is_active', true)
      .not('session_cookies', 'is', null)
      .limit(1)
      .single();

    if (error || !data) {
      console.error('[DB] Failed to load account:', error?.message);
      return null;
    }

    return data;
  }

  // ─── Daily Matches ─────────────────────────────────────────────────────

  async upsertDailyMatches(matches: DailyMatch[], date: string): Promise<void> {
    // Delete existing matches for today first
    await this.supabase
      .from('tennis_daily_matches')
      .delete()
      .eq('match_date', date);

    const rows = matches.map(m => ({
      match_date: date,
      tournament: m.tournament || '',
      country: m.country || '',
      gender: m.gender || 'Men',
      category: m.category || 'Singles',
      surface: m.surface || 'Hard',
      player1_name: m.player1.name,
      player1_ranking: m.player1.ranking,
      player1_form: m.player1.formScore,
      player1_odds: m.player1.odds,
      player2_name: m.player2.name,
      player2_ranking: m.player2.ranking,
      player2_form: m.player2.formScore,
      player2_odds: m.player2.odds,
      scheduled_time: m.scheduledTime || null,
      status: m.status || 'upcoming',
      h2h_url: m.h2hUrl || null,
    }));

    const { error } = await this.supabase
      .from('tennis_daily_matches')
      .insert(rows);

    if (error) {
      console.error('[DB] Failed to insert matches:', error.message);
    } else {
      console.log(`[DB] Inserted ${rows.length} matches for ${date}`);
    }
  }

  // ─── H2H Records ──────────────────────────────────────────────────────

  async upsertH2H(h2h: H2HData): Promise<void> {
    const row = {
      h2h_key: h2h.h2hKey,
      player1: h2h.player1,
      player2: h2h.player2,
      player1_wins: h2h.h2hRecord.player1Wins,
      player2_wins: h2h.h2hRecord.player2Wins,
      player1_sets: h2h.setsWon.player1,
      player2_sets: h2h.setsWon.player2,
      match_history: h2h.matchHistory,
      comparison_stats: h2h.comparisonStats,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.supabase
      .from('tennis_h2h')
      .upsert(row, { onConflict: 'h2h_key' });

    if (error) {
      console.error('[DB] Failed to upsert H2H ' + h2h.h2hKey + ':', error.message);
    }
  }

  // ─── Player Stats ─────────────────────────────────────────────────────

  async upsertPlayer(player: PlayerStats): Promise<void> {
    if (!player || !player.name) return;

    const slug = player.slug || player.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    const row = {
      name: player.name,
      slug,
      country: player.country || null,
      ranking: player.ranking || null,
      elo_score: player.eloScore || null,
      age: player.age || null,
      height: player.height || null,
      weight: player.weight || null,
      hand: player.hand || null,
      form_score: player.formScore || null,
      career_wins: player.careerWins || 0,
      career_losses: player.careerLosses || 0,
      career_win_pct: player.careerWinPct || null,
      current_year_win_pct: player.currentYearWinPct || null,
      trailing_12m_win_pct: player.trailing12mWinPct || null,
      hard_win_pct: player.hardWinPct || null,
      clay_win_pct: player.clayWinPct || null,
      grass_win_pct: player.grassWinPct || null,
      aces_per_match: player.acesPerMatch || null,
      straight_sets_win_pct: player.straightSetsWinPct || null,
      comeback_win_pct: player.comebackWinPct || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.supabase
      .from('tennis_players')
      .upsert(row, { onConflict: 'slug' });

    if (error) {
      console.error('[DB] Failed to upsert player ' + player.name + ':', error.message);
    }
  }
}

export default TennisStatsDB;
