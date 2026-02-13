/**
 * Supabase Integration for TennisStats Scraper
 * 
 * Stores scraped data into SharpEdge's Supabase database
 * Tables to create: tennis_players, tennis_h2h, tennis_daily_matches
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DailyMatch, PlayerStats, H2HData } from './scraper';

export class TennisStatsDB {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  // ─── Upsert Player Stats ──────────────────────────────────────────────

  async upsertPlayerStats(player: PlayerStats): Promise<void> {
    const { error } = await this.supabase
      .from('tennis_players')
      .upsert(
        {
          name: player.name,
          slug: player.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          country: player.country,
          ranking: player.ranking,
          elo_score: player.eloScore,
          age: player.age,
          height: player.height,
          weight: player.weight,
          hand: player.hand,
          form_score: player.formScore,
          career_wins: player.careerWins,
          career_losses: player.careerLosses,
          career_win_pct: player.careerWinPct,
          current_year_win_pct: player.currentYearWinPct,
          trailing_12m_win_pct: player.trailing12MonthsWinPct,
          hard_win_pct: player.surfaceWinPct.hard,
          clay_win_pct: player.surfaceWinPct.clay,
          grass_win_pct: player.surfaceWinPct.grass,
          aces_per_match: player.acesPerMatch,
          serve_speed: player.serveSpeed,
          career_prize_money: player.careerPrizeMoney,
          titles: player.titles,
          grand_slams: player.grandSlams,
          straight_sets_win_pct: player.straightSetsWinPct,
          comeback_win_pct: player.comebackWinPct,
          set1_win_pct: player.set1WinPct,
          set2_win_pct: player.set2WinPct,
          set3_win_pct: player.set3WinPct,
          avg_total_games_3sets: player.avgTotalGames3Sets,
          avg_total_games_5sets: player.avgTotalGames5Sets,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'slug' }
      );

    if (error) {
      console.error(`[DB] Error upserting player ${player.name}:`, error.message);
    }
  }

  // ─── Upsert H2H Data ──────────────────────────────────────────────────

  async upsertH2H(h2h: H2HData, h2hPath: string): Promise<void> {
    const { error } = await this.supabase
      .from('tennis_h2h')
      .upsert(
        {
          h2h_key: h2hPath,
          player1: h2h.player1,
          player2: h2h.player2,
          player1_wins: h2h.h2hRecord.player1Wins,
          player2_wins: h2h.h2hRecord.player2Wins,
          player1_sets: h2h.setsWon.player1,
          player2_sets: h2h.setsWon.player2,
          match_history: h2h.matchHistory,
          comparison_stats: h2h.comparison,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'h2h_key' }
      );

    if (error) {
      console.error(`[DB] Error upserting H2H ${h2h.player1} vs ${h2h.player2}:`, error.message);
    }
  }

  // ─── Insert Daily Matches ─────────────────────────────────────────────

  async upsertDailyMatches(matches: DailyMatch[], date: string): Promise<void> {
    // Delete existing matches for this date to avoid duplicates
    await this.supabase
      .from('tennis_daily_matches')
      .delete()
      .eq('match_date', date);

    const rows = matches.map((m) => ({
      match_date: date,
      tournament: m.tournament,
      country: m.country,
      gender: m.gender,
      category: m.category,
      surface: m.surface,
      player1_name: m.player1.name,
      player1_ranking: m.player1.ranking,
      player1_form: m.player1.formScore,
      player1_odds: m.player1.odds,
      player2_name: m.player2.name,
      player2_ranking: m.player2.ranking,
      player2_form: m.player2.formScore,
      player2_odds: m.player2.odds,
      scheduled_time: m.scheduledTime,
      status: m.status,
      h2h_url: m.h2hUrl,
      created_at: new Date().toISOString(),
    }));

    const { error } = await this.supabase
      .from('tennis_daily_matches')
      .insert(rows);

    if (error) {
      console.error(`[DB] Error inserting daily matches:`, error.message);
    } else {
      console.log(`[DB] Inserted ${rows.length} matches for ${date}`);
    }
  }
}

export default TennisStatsDB;
