/**
 * Supported Tournaments Filter
 * 
 * Only scrape matches from Grand Slams, Masters 1000, ATP 500, and WTA 500/1000
 */

interface TournamentInfo {
  name: string;
  tier: 'Grand Slam' | 'Masters 1000' | 'WTA 1000' | 'ATP 500' | 'WTA 500';
  gender: 'Men' | 'Women' | 'Both';
  keywords: string[]; // Keywords to match against homepage tournament names
}

const SUPPORTED_TOURNAMENTS: TournamentInfo[] = [
  // ── Grand Slams (Both) ──────────────────────────────────────
  { name: 'Australian Open', tier: 'Grand Slam', gender: 'Both', keywords: ['australian open'] },
  { name: 'French Open', tier: 'Grand Slam', gender: 'Both', keywords: ['french open', 'roland garros', 'roland-garros'] },
  { name: 'Wimbledon', tier: 'Grand Slam', gender: 'Both', keywords: ['wimbledon'] },
  { name: 'US Open', tier: 'Grand Slam', gender: 'Both', keywords: ['us open'] },

  // ── ATP Masters 1000 ────────────────────────────────────────
  { name: 'Indian Wells Masters', tier: 'Masters 1000', gender: 'Men', keywords: ['indian wells'] },
  { name: 'Miami Open', tier: 'Masters 1000', gender: 'Men', keywords: ['miami'] },
  { name: 'Monte-Carlo Masters', tier: 'Masters 1000', gender: 'Men', keywords: ['monte carlo', 'monte-carlo'] },
  { name: 'Madrid Open', tier: 'Masters 1000', gender: 'Men', keywords: ['madrid'] },
  { name: 'Italian Open', tier: 'Masters 1000', gender: 'Men', keywords: ['rome', 'italian open', 'internazionali'] },
  { name: 'Canadian Open', tier: 'Masters 1000', gender: 'Men', keywords: ['canadian', 'montreal', 'toronto'] },
  { name: 'Cincinnati Open', tier: 'Masters 1000', gender: 'Men', keywords: ['cincinnati'] },
  { name: 'Shanghai Masters', tier: 'Masters 1000', gender: 'Men', keywords: ['shanghai'] },
  { name: 'Paris Masters', tier: 'Masters 1000', gender: 'Men', keywords: ['paris'] },

  // ── WTA 1000 ────────────────────────────────────────────────
  { name: 'Qatar Open', tier: 'WTA 1000', gender: 'Women', keywords: ['doha', 'qatar'] },
  { name: 'Dubai Tennis Championships', tier: 'WTA 1000', gender: 'Women', keywords: ['dubai'] },
  { name: 'Indian Wells Open', tier: 'WTA 1000', gender: 'Women', keywords: ['indian wells'] },
  { name: 'Miami Open', tier: 'WTA 1000', gender: 'Women', keywords: ['miami'] },
  { name: 'Madrid Open', tier: 'WTA 1000', gender: 'Women', keywords: ['madrid'] },
  { name: 'Italian Open', tier: 'WTA 1000', gender: 'Women', keywords: ['rome', 'italian open'] },
  { name: 'Canadian Open', tier: 'WTA 1000', gender: 'Women', keywords: ['canadian', 'montreal', 'toronto'] },
  { name: 'Cincinnati Open', tier: 'WTA 1000', gender: 'Women', keywords: ['cincinnati'] },
  { name: 'China Open', tier: 'WTA 1000', gender: 'Women', keywords: ['beijing', 'china open'] },
  { name: 'Wuhan Open', tier: 'WTA 1000', gender: 'Women', keywords: ['wuhan'] },

  // ── ATP 500 ─────────────────────────────────────────────────
  { name: 'Rotterdam Open', tier: 'ATP 500', gender: 'Men', keywords: ['rotterdam'] },
  { name: 'Rio Open', tier: 'ATP 500', gender: 'Men', keywords: ['rio'] },
  { name: 'Mexican Open', tier: 'ATP 500', gender: 'Men', keywords: ['acapulco', 'mexican open'] },
  { name: 'Barcelona Open', tier: 'ATP 500', gender: 'Men', keywords: ['barcelona'] },
  { name: 'Hamburg Open', tier: 'ATP 500', gender: 'Men', keywords: ['hamburg'] },
  { name: "Queen's Club", tier: 'ATP 500', gender: 'Men', keywords: ["queen's", 'queens'] },
  { name: 'Halle Open', tier: 'ATP 500', gender: 'Men', keywords: ['halle'] },
  { name: 'Washington Open', tier: 'ATP 500', gender: 'Men', keywords: ['washington'] },
  { name: 'China Open', tier: 'ATP 500', gender: 'Men', keywords: ['beijing', 'china open'] },
  { name: 'Tokyo Open', tier: 'ATP 500', gender: 'Men', keywords: ['tokyo'] },
  { name: 'Vienna Open', tier: 'ATP 500', gender: 'Men', keywords: ['vienna'] },
  { name: 'Basel Open', tier: 'ATP 500', gender: 'Men', keywords: ['basel'] },
  { name: 'Dubai Tennis Championships', tier: 'ATP 500', gender: 'Men', keywords: ['dubai'] },

  // ── WTA 500 ─────────────────────────────────────────────────
  { name: 'Adelaide International', tier: 'WTA 500', gender: 'Women', keywords: ['adelaide'] },
  { name: 'Brisbane International', tier: 'WTA 500', gender: 'Women', keywords: ['brisbane'] },
  { name: 'St. Petersburg Open', tier: 'WTA 500', gender: 'Women', keywords: ['st. petersburg', 'st petersburg', 'saint petersburg'] },
  { name: 'Charleston Open', tier: 'WTA 500', gender: 'Women', keywords: ['charleston'] },
  { name: 'Stuttgart Open', tier: 'WTA 500', gender: 'Women', keywords: ['stuttgart'] },
  { name: 'Washington Open', tier: 'WTA 500', gender: 'Women', keywords: ['washington'] },
  { name: 'San Diego Open', tier: 'WTA 500', gender: 'Women', keywords: ['san diego'] },
  { name: 'Tokyo Open', tier: 'WTA 500', gender: 'Women', keywords: ['tokyo'] },
  { name: 'Zhengzhou Open', tier: 'WTA 500', gender: 'Women', keywords: ['zhengzhou'] },
  { name: 'Linz Open', tier: 'WTA 500', gender: 'Women', keywords: ['linz'] },
  { name: 'Moscow Open', tier: 'WTA 500', gender: 'Women', keywords: ['moscow'] },
  { name: 'Abu Dhabi Open', tier: 'WTA 500', gender: 'Women', keywords: ['abu dhabi'] },
  { name: 'Eastbourne International', tier: 'WTA 500', gender: 'Women', keywords: ['eastbourne'] },
];

/**
 * Check if a tournament from TennisStats homepage matches a supported tournament.
 * Returns the tournament info if matched, null if not supported.
 * 
 * Homepage format examples: "Rotterdam ATP", "Buenos Aires ATP", "Australian Open"
 */
export function matchTournament(
  homepageName: string,
  gender: 'Men' | 'Women'
): TournamentInfo | null {
  const nameLower = homepageName.toLowerCase().trim();

  for (const t of SUPPORTED_TOURNAMENTS) {
    // Check gender compatibility
    if (t.gender !== 'Both' && t.gender !== gender) continue;

    // Check if any keyword matches
    for (const keyword of t.keywords) {
      if (nameLower.includes(keyword)) {
        return t;
      }
    }
  }

  return null;
}

/**
 * Filter an array of matches to only supported tournaments
 */
export function filterSupportedMatches<T extends { tournament: string; gender: string }>(
  matches: T[]
): (T & { tournamentTier: string; tournamentOfficialName: string })[] {
  const supported: (T & { tournamentTier: string; tournamentOfficialName: string })[] = [];
  const skipped = new Set<string>();

  for (const match of matches) {
    const info = matchTournament(match.tournament, match.gender as 'Men' | 'Women');
    if (info) {
      supported.push({
        ...match,
        tournamentTier: info.tier,
        tournamentOfficialName: info.name,
      } as T & { tournamentTier: string; tournamentOfficialName: string });
    } else {
      skipped.add(match.tournament);
    }
  }

  if (skipped.size > 0) {
    console.log('[Filter] Skipped unsupported tournaments: ' + Array.from(skipped).join(', '));
  }
  console.log('[Filter] ' + supported.length + ' matches from supported tournaments (out of ' + matches.length + ')');

  return supported;
}

export { SUPPORTED_TOURNAMENTS, TournamentInfo };
