/**
 * Supabase Database Layer for TennisStats Scraper v2
 * Stores all H2H detail data in structured columns
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DailyMatch, H2HData } from './scraper';

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
    await this.supabase
      .from('tennis_daily_matches')
      .delete()
      .eq('match_date', date);

    const rows = matches.map(m => ({
      match_date: date,
      tournament: m.tournament || '',
      tournament_tier: m.tournamentTier || '',
      tournament_official_name: m.tournamentOfficialName || '',
      country: m.country || '',
      gender: m.gender || 'Men',
      category: m.category || 'Singles',
      surface: m.surface || 'Hard',
      round: m.round || 'Main',
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

  // ─── H2H Records (Comprehensive) ──────────────────────────────────────

  async upsertH2H(h2h: H2HData): Promise<void> {
    const row = {
      h2h_key: h2h.h2hKey,
      player1: h2h.player1,
      player2: h2h.player2,
      // Full Stats
      p1_rank: h2h.p1Rank || null,
      p2_rank: h2h.p2Rank || null,
      player1_wins: h2h.p1H2HWins,
      player2_wins: h2h.p2H2HWins,
      player1_sets: h2h.p1H2HSets,
      player2_sets: h2h.p2H2HSets,
      p1_calendar_year_win_pct: h2h.p1CalendarYearWinPct || null,
      p1_calendar_year_record: h2h.p1CalendarYearRecord || null,
      p2_calendar_year_win_pct: h2h.p2CalendarYearWinPct || null,
      p2_calendar_year_record: h2h.p2CalendarYearRecord || null,
      p1_last_12m_win_pct: h2h.p1Last12mWinPct || null,
      p1_last_12m_record: h2h.p1Last12mRecord || null,
      p2_last_12m_win_pct: h2h.p2Last12mWinPct || null,
      p2_last_12m_record: h2h.p2Last12mRecord || null,
      // Match History
      match_history: h2h.matchHistory,
      // Win % Breakdown
      p1_match_wins_pct: h2h.p1MatchWinsPct || null,
      p2_match_wins_pct: h2h.p2MatchWinsPct || null,
      p1_straight_sets_pct: h2h.p1StraightSetsPct || null,
      p2_straight_sets_pct: h2h.p2StraightSetsPct || null,
      p1_wins_from_behind_pct: h2h.p1WinsFromBehindPct || null,
      p2_wins_from_behind_pct: h2h.p2WinsFromBehindPct || null,
      p1_set1_win_pct: h2h.p1Set1WinPct || null,
      p2_set1_win_pct: h2h.p2Set1WinPct || null,
      p1_set2_win_pct: h2h.p1Set2WinPct || null,
      p2_set2_win_pct: h2h.p2Set2WinPct || null,
      p1_set3_win_pct: h2h.p1Set3WinPct || null,
      p2_set3_win_pct: h2h.p2Set3WinPct || null,
      // Serve & Return
      p1_aces_per_match: h2h.p1AcesPerMatch || null,
      p2_aces_per_match: h2h.p2AcesPerMatch || null,
      aces_match_total: h2h.acesMatchTotal || null,
      p1_double_faults_per_match: h2h.p1DoubleFaultsPerMatch || null,
      p2_double_faults_per_match: h2h.p2DoubleFaultsPerMatch || null,
      double_faults_match_total: h2h.doubleFaultsMatchTotal || null,
      p1_breaks_per_match: h2h.p1BreaksPerMatch || null,
      p2_breaks_per_match: h2h.p2BreaksPerMatch || null,
      breaks_match_total: h2h.breaksMatchTotal || null,
      p1_tiebreaks_per_match: h2h.p1TiebreaksPerMatch || null,
      p2_tiebreaks_per_match: h2h.p2TiebreaksPerMatch || null,
      tiebreaks_average: h2h.tiebreaksAverage || null,
      // Match Total Games
      p1_avg_games_per_set: h2h.p1AvgGamesPerSet || null,
      p2_avg_games_per_set: h2h.p2AvgGamesPerSet || null,
      avg_games_per_set: h2h.avgGamesPerSet || null,
      games_over_20_5_pct: h2h.gamesOver20_5Pct || null,
      games_over_21_5_pct: h2h.gamesOver21_5Pct || null,
      games_over_22_5_pct: h2h.gamesOver22_5Pct || null,
      games_over_23_5_pct: h2h.gamesOver23_5Pct || null,
      games_over_24_5_pct: h2h.gamesOver24_5Pct || null,
      comparison_stats: null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.supabase
      .from('tennis_h2h')
      .upsert(row, { onConflict: 'h2h_key' });

    if (error) {
      console.error('[DB] Failed to upsert H2H ' + h2h.h2hKey + ':', error.message);
    }
  }
  async hasMatchesForDate(date: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('tennis_daily_matches')
      .select('id')
      .eq('match_date', date)
      .limit(1);
    return !!(data && data.length > 0);
  }
}

export default TennisStatsDB;
