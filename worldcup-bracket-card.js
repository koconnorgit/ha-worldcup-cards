/**
 * World Cup Bracket Card — a custom Lovelace card for Home Assistant.
 *
 * A companion to worldcup-card.js (schedule) and worldcup-standings-card.js.
 * Draws the full FIFA World Cup 2026 knockout bracket — Round of 32 through the
 * Final, with the third-place play-off — as a classic two-sided bracket that
 * meets at a centered final. Best given a wide / full-width slot on the
 * dashboard (it requests full width in the sections view and scrolls
 * horizontally if the viewport is narrow).
 *
 * Where the teams come from — in priority order:
 *   1. Live knockout fixtures from TheSportsDB, once they exist (real teams +
 *      scores). A finished tie's winner is propagated into the next round.
 *   2. Our own derivation: group winners/runners-up are computed from the
 *      group-stage results (the same fixtures the schedule/standings cards use),
 *      so a Round-of-32 slot fills in as soon as a group takes shape — even
 *      before TheSportsDB publishes the knockout draw. Slots whose group isn't
 *      mathematically decided yet are shown "provisional" (dimmed + dotted).
 *   3. The fixed FIFA schedule (KNOCKOUT_2026 below) for the structure, kickoff
 *      times and venues, with placeholder slot labels (1A, 2B, 3rd, W73, …)
 *      until a real team resolves.
 *
 * Note: the eight best-third-placed slots ("3rd Group A/B/C/…") are left as
 * placeholders — FIFA's assignment of which third-placed teams land in which
 * Round-of-32 tie depends on exactly which groups' thirds qualify, via an
 * official combination table, and isn't derived here.
 *
 * Install:
 *   1. Copy this file to  /config/www/worldcup-bracket-card.js
 *   2. Settings → Dashboards → ⋮ → Resources → Add Resource
 *        URL: /local/worldcup-bracket-card.js   Type: JavaScript Module
 *   3. Add a card to a dashboard with at minimum:
 *        type: custom:worldcup-bracket-card
 *
 * Full YAML options (all optional):
 *   type: custom:worldcup-bracket-card
 *   title: "World Cup 2026 — Bracket"  # card header; "" to hide
 *   refresh: 120             # auto-refresh interval in seconds (min 30)
 *   season: "2026"           # tournament season
 *   league_id: "4429"        # TheSportsDB league id (4429 = FIFA World Cup)
 *   group_rounds: [1,2,3]    # round codes that make up the group stage
 *   api_key: "123"           # TheSportsDB free test key; replace with your own
 *
 * Like the other cards, each round is cached in the browser once all its
 * fixtures finish; a throttled/failed poll falls back to the last cached data.
 */

(() => {
const DEFAULTS = {
  title: "World Cup 2026 — Bracket",
  refresh: 120,
  season: "2026",
  league_id: "4429",
  group_rounds: [1, 2, 3],
  // Knockout round codes (R32, R16, QF, SF, third-place, Final).
  knockout_rounds: [32, 16, 125, 150, 160, 200],
  api_key: "123",
};

const FINISHED = new Set(["FT", "AET", "PEN", "Match Finished", "AP", "FT_PEN"]);
const NOT_STARTED = new Set(["NS", "", "Not Started", "TBD", "Time To Be Defined", null, undefined]);

// FIFA 3-letter country codes, keyed by the exact team name TheSportsDB returns.
// (Kept in sync with worldcup-card.js / worldcup-standings-card.js.)
const TEAM_CODES = {
  Algeria: "ALG", Argentina: "ARG", Australia: "AUS", Austria: "AUT",
  Belgium: "BEL", "Bosnia-Herzegovina": "BIH", Brazil: "BRA", Canada: "CAN",
  "Cape Verde": "CPV", Colombia: "COL", Croatia: "CRO", "Curaçao": "CUW",
  "Czech Republic": "CZE", "DR Congo": "COD", Ecuador: "ECU", Egypt: "EGY",
  England: "ENG", France: "FRA", Germany: "GER", Ghana: "GHA", Haiti: "HAI",
  Iran: "IRN", Iraq: "IRQ", "Ivory Coast": "CIV", Japan: "JPN", Jordan: "JOR",
  Mexico: "MEX", Morocco: "MAR", Netherlands: "NED", "New Zealand": "NZL",
  Norway: "NOR", Panama: "PAN", Paraguay: "PAR", Portugal: "POR", Qatar: "QAT",
  "Saudi Arabia": "KSA", Scotland: "SCO", Senegal: "SEN", "South Africa": "RSA",
  "South Korea": "KOR", Spain: "ESP", Sweden: "SWE", Switzerland: "SUI",
  Tunisia: "TUN", Turkey: "TUR", USA: "USA", Uruguay: "URU", Uzbekistan: "UZB",
};

// FIFA 2026 knockout schedule — fixed dates/times/venues + bracket slots.
// (Kept in sync with KNOCKOUT_2026 in worldcup-card.js.) `ts` is naive-UTC.
const KNOCKOUT_2026 = [
  { m: 73, round: 32, ts: "2026-06-28T19:00:00", venue: "SoFi Stadium, Inglewood", home: "Runner-up Group A", away: "Runner-up Group B" },
  { m: 74, round: 32, ts: "2026-06-29T20:30:00", venue: "Gillette Stadium, Foxborough", home: "Winner Group E", away: "3rd Group A/B/C/D/F" },
  { m: 75, round: 32, ts: "2026-06-30T01:00:00", venue: "Estadio BBVA, Guadalupe", home: "Winner Group F", away: "Runner-up Group C" },
  { m: 76, round: 32, ts: "2026-06-29T17:00:00", venue: "NRG Stadium, Houston", home: "Winner Group C", away: "Runner-up Group F" },
  { m: 77, round: 32, ts: "2026-06-30T21:00:00", venue: "MetLife Stadium, East Rutherford", home: "Winner Group I", away: "3rd Group C/D/F/G/H" },
  { m: 78, round: 32, ts: "2026-06-30T17:00:00", venue: "AT&T Stadium, Arlington", home: "Runner-up Group E", away: "Runner-up Group I" },
  { m: 79, round: 32, ts: "2026-07-01T01:00:00", venue: "Estadio Azteca, Mexico City", home: "Mexico", away: "3rd Group C/E/F/H/I" },
  { m: 80, round: 32, ts: "2026-07-01T16:00:00", venue: "Mercedes-Benz Stadium, Atlanta", home: "Winner Group L", away: "3rd Group E/H/I/J/K" },
  { m: 81, round: 32, ts: "2026-07-02T00:00:00", venue: "Levi's Stadium, Santa Clara", home: "Winner Group D", away: "3rd Group B/E/F/I/J" },
  { m: 82, round: 32, ts: "2026-07-01T20:00:00", venue: "Lumen Field, Seattle", home: "Winner Group G", away: "3rd Group A/E/H/I/J" },
  { m: 83, round: 32, ts: "2026-07-02T23:00:00", venue: "BMO Field, Toronto", home: "Runner-up Group K", away: "Runner-up Group L" },
  { m: 84, round: 32, ts: "2026-07-02T19:00:00", venue: "SoFi Stadium, Inglewood", home: "Winner Group H", away: "Runner-up Group J" },
  { m: 85, round: 32, ts: "2026-07-03T03:00:00", venue: "BC Place, Vancouver", home: "Winner Group B", away: "3rd Group E/F/G/I/J" },
  { m: 86, round: 32, ts: "2026-07-03T22:00:00", venue: "Hard Rock Stadium, Miami Gardens", home: "Winner Group J", away: "Runner-up Group H" },
  { m: 87, round: 32, ts: "2026-07-04T01:30:00", venue: "Arrowhead Stadium, Kansas City", home: "Winner Group K", away: "3rd Group D/E/I/J/L" },
  { m: 88, round: 32, ts: "2026-07-03T18:00:00", venue: "AT&T Stadium, Arlington", home: "Runner-up Group D", away: "Runner-up Group G" },
  { m: 89, round: 16, ts: "2026-07-04T21:00:00", venue: "Lincoln Financial Field, Philadelphia", home: "Winner Match 74", away: "Winner Match 77" },
  { m: 90, round: 16, ts: "2026-07-04T17:00:00", venue: "NRG Stadium, Houston", home: "Winner Match 73", away: "Winner Match 75" },
  { m: 91, round: 16, ts: "2026-07-05T20:00:00", venue: "MetLife Stadium, East Rutherford", home: "Winner Match 76", away: "Winner Match 78" },
  { m: 92, round: 16, ts: "2026-07-06T00:00:00", venue: "Estadio Azteca, Mexico City", home: "Winner Match 79", away: "Winner Match 80" },
  { m: 93, round: 16, ts: "2026-07-06T19:00:00", venue: "AT&T Stadium, Arlington", home: "Winner Match 83", away: "Winner Match 84" },
  { m: 94, round: 16, ts: "2026-07-07T00:00:00", venue: "Lumen Field, Seattle", home: "Winner Match 81", away: "Winner Match 82" },
  { m: 95, round: 16, ts: "2026-07-07T16:00:00", venue: "Mercedes-Benz Stadium, Atlanta", home: "Winner Match 86", away: "Winner Match 88" },
  { m: 96, round: 16, ts: "2026-07-07T20:00:00", venue: "BC Place, Vancouver", home: "Winner Match 85", away: "Winner Match 87" },
  { m: 97, round: 125, ts: "2026-07-09T20:00:00", venue: "Gillette Stadium, Foxborough", home: "Winner Match 89", away: "Winner Match 90" },
  { m: 98, round: 125, ts: "2026-07-10T19:00:00", venue: "SoFi Stadium, Inglewood", home: "Winner Match 93", away: "Winner Match 94" },
  { m: 99, round: 125, ts: "2026-07-11T21:00:00", venue: "Hard Rock Stadium, Miami Gardens", home: "Winner Match 91", away: "Winner Match 92" },
  { m: 100, round: 125, ts: "2026-07-12T01:00:00", venue: "Arrowhead Stadium, Kansas City", home: "Winner Match 95", away: "Winner Match 96" },
  { m: 101, round: 150, ts: "2026-07-14T19:00:00", venue: "AT&T Stadium, Arlington", home: "Winner Match 97", away: "Winner Match 98" },
  { m: 102, round: 150, ts: "2026-07-15T19:00:00", venue: "Mercedes-Benz Stadium, Atlanta", home: "Winner Match 99", away: "Winner Match 100" },
  { m: 103, round: 160, ts: "2026-07-18T21:00:00", venue: "Hard Rock Stadium, Miami Gardens", home: "Loser Match 101", away: "Loser Match 102" },
  { m: 104, round: 200, ts: "2026-07-19T19:00:00", venue: "MetLife Stadium, East Rutherford", home: "Winner Match 101", away: "Winner Match 102" },
];

// Bracket tree: each match number → its two feeder match numbers, top → bottom.
// Round-of-32 ties (73–88) are leaves. The final (104) is drawn in the centre;
// its two halves hang off the semi-finals 101 (left) and 102 (right).
const CHILDREN = {
  101: [97, 98], 102: [99, 100],
  97: [89, 90], 98: [93, 94], 99: [91, 92], 100: [95, 96],
  89: [74, 77], 90: [73, 75], 93: [83, 84], 94: [81, 82],
  91: [76, 78], 92: [79, 80], 95: [86, 88], 96: [85, 87],
};

const ROUND_NAME = { 32: "Round of 32", 16: "Round of 16", 125: "Quarter-finals", 150: "Semi-finals", 160: "Third place", 200: "Final" };

class WorldCupBracketCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { ...DEFAULTS };
    this._matches = null; // resolved bracket: { [m]: {...} }
    this._error = null;
    this._loading = true;
    this._lastSig = null;
    this._timer = null;
    this._lastFetch = null;
    this._rateLimited = false;
  }

  setConfig(config) {
    this._config = { ...DEFAULTS, ...(config || {}) };
    this._config.refresh = Math.max(30, Number(this._config.refresh) || DEFAULTS.refresh);
    if (!Array.isArray(this._config.group_rounds)) this._config.group_rounds = DEFAULTS.group_rounds;
    if (!Array.isArray(this._config.knockout_rounds)) this._config.knockout_rounds = DEFAULTS.knockout_rounds;
    if (this.isConnected) {
      this._stop();
      this._start();
    }
  }

  set hass(hass) {
    this._hass = hass;
  }

  getCardSize() {
    return 12;
  }

  // This is a very wide card (a full two-sided bracket). Ask the sections-view
  // grid for the full 12-column span — the widest a single card can request —
  // and a tall row count. On narrower placements it scrolls horizontally.
  getGridOptions() {
    return { columns: "full", rows: 10, min_columns: 8 };
  }

  static getStubConfig() {
    return { type: "custom:worldcup-bracket-card" };
  }

  connectedCallback() {
    this._start();
  }

  disconnectedCallback() {
    this._stop();
  }

  _start() {
    this._fetch();
    this._timer = setInterval(() => this._fetch(), this._config.refresh * 1000);
  }

  _stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  // --- per-round browser cache (mirrors the other cards) -------------------
  _cacheKey(round) {
    return `wc-bracket:r:${this._config.league_id}:${this._config.season}:${round}`;
  }
  _cacheGet(round) {
    try {
      const raw = localStorage.getItem(this._cacheKey(round));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  _cacheSet(round, payload) {
    try {
      localStorage.setItem(this._cacheKey(round), JSON.stringify(payload));
    } catch (e) {
      /* storage full / unavailable — ignore */
    }
  }

  async _fetchRound(round) {
    const cached = this._cacheGet(round);
    if (cached && cached.final) return cached.events;
    const { api_key, league_id, season } = this._config;
    try {
      const r = await fetch(
        `https://www.thesportsdb.com/api/v1/json/${api_key}/eventsround.php?id=${league_id}&r=${round}&s=${encodeURIComponent(season)}`
      );
      if (!r.ok) {
        if (r.status === 429) this._rateLimited = true;
        return cached ? cached.events : [];
      }
      const j = await r.json();
      const events = j.events || [];
      const final = events.length > 0 && events.every((e) => this._state(e) === "final");
      this._cacheSet(round, { final, events });
      return events;
    } catch (e) {
      return cached ? cached.events : [];
    }
  }

  async _pool(items, limit, worker) {
    const results = new Array(items.length);
    let i = 0;
    const run = async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await worker(items[idx], idx);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
  }

  async _fetch() {
    const groupRounds = this._config.group_rounds;
    const koRounds = this._config.knockout_rounds;
    const rounds = [...groupRounds, ...koRounds];
    this._rateLimited = false;
    try {
      const results = await this._pool(rounds, 5, (r) => this._fetchRound(r));
      if (!this._rateLimited) this._lastFetch = new Date();

      const groupEvents = [];
      const koEvents = [];
      const seen = new Set();
      rounds.forEach((round, idx) => {
        for (const e of results[idx] || []) {
          const id = e.idEvent || `${e.dateEvent}-${e.strEvent}`;
          if (seen.has(id)) continue;
          seen.add(id);
          if (groupRounds.includes(round)) groupEvents.push(e);
          else koEvents.push(e);
        }
      });

      const matches = this._buildBracket(groupEvents, koEvents);

      this._matches = matches;
      this._error = null;
      this._loading = false;

      const sig = JSON.stringify(
        Object.values(matches).map((m) => [m.m, m.home.team, m.away.team, m.home.prov, m.away.prov, m.hs, m.as, m.state])
      );
      if (sig !== this._lastSig) {
        this._lastSig = sig;
        this._render();
      } else {
        this._touchUpdatedLine();
      }
    } catch (err) {
      this._lastFetch = new Date();
      if (this._matches) {
        this._touchUpdatedLine();
      } else {
        this._error = err && err.message ? err.message : String(err);
        this._loading = false;
        this._render();
      }
    }
  }

  // Compute group winner/runner-up ordering from group-stage fixtures. Returns
  // { rank: {A:[t1,t2,t3,t4],…}, decided: {A:bool} } where decided means all six
  // group matches have finished.
  _groupStandings(events) {
    const groups = new Map(); // letter -> Map(team -> stats)
    const finished = new Map(); // letter -> count of finished matches
    const stat = (g, name) => {
      if (!groups.has(g)) groups.set(g, new Map());
      const m = groups.get(g);
      if (!m.has(name)) m.set(name, { t: name, P: 0, W: 0, D: 0, GF: 0, GA: 0 });
      return m.get(name);
    };
    for (const e of events) {
      if (!e.strGroup || !e.strHomeTeam || !e.strAwayTeam) continue;
      if (this._state(e) !== "final") continue;
      const hs = Number(e.intHomeScore), as = Number(e.intAwayScore);
      if (Number.isNaN(hs) || Number.isNaN(as)) continue;
      const g = String(e.strGroup).replace(/^group\s*/i, "").trim().toUpperCase();
      finished.set(g, (finished.get(g) || 0) + 1);
      const h = stat(g, e.strHomeTeam), a = stat(g, e.strAwayTeam);
      h.P++; a.P++; h.GF += hs; h.GA += as; a.GF += as; a.GA += hs;
      if (hs > as) { h.W++; }
      else if (hs < as) { a.W++; }
      else { h.D++; a.D++; }
    }
    const rank = {}, decided = {};
    for (const [g, m] of groups) {
      const rows = [...m.values()];
      for (const s of rows) { s.Pts = s.W * 3 + s.D; s.GD = s.GF - s.GA; }
      rows.sort((a, b) =>
        b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || String(a.t).localeCompare(String(b.t))
      );
      rank[g] = rows.map((s) => s.t);
      decided[g] = (finished.get(g) || 0) >= 6; // 4 teams → 6 matches
    }
    return { rank, decided };
  }

  // Build the resolved bracket. `koEvents` are live knockout fixtures (real
  // teams/scores) when TheSportsDB has them; we overlay those onto the static
  // structure by matching the two resolved team names.
  _buildBracket(groupEvents, koEvents) {
    const { rank, decided } = this._groupStandings(groupEvents);

    // Index static fixtures by match number.
    const M = {};
    for (const k of KNOCKOUT_2026) {
      M[k.m] = {
        m: k.m, round: k.round, ts: k.ts, venue: k.venue,
        homeLabel: k.home, awayLabel: k.away,
        home: { team: null, prov: false, label: k.home },
        away: { team: null, prov: false, label: k.away },
        hs: null, as: null, status: "", state: "upcoming",
        winner: null, loser: null,
      };
    }

    // Group live knockout events by round so we can match them per round, after
    // that round's slots have resolved.
    const koByRound = new Map();
    for (const e of koEvents) {
      const r = Number(e.intRound);
      if (!koByRound.has(r)) koByRound.set(r, []);
      koByRound.get(r).push(e);
    }

    const resolveSlot = (label) => {
      const s = String(label).trim();
      let mm;
      if ((mm = /^Winner(?:s)? Group ([A-L])$/i.exec(s))) {
        const g = mm[1].toUpperCase();
        return { team: (rank[g] || [])[0] || null, prov: !decided[g], label: s };
      }
      if ((mm = /^Runner(?:s)?-up Group ([A-L])$/i.exec(s))) {
        const g = mm[1].toUpperCase();
        return { team: (rank[g] || [])[1] || null, prov: !decided[g], label: s };
      }
      if (/^3rd Group/i.test(s)) return { team: null, prov: false, label: s }; // not derived
      if ((mm = /^Winner(?:s)? Match (\d+)$/i.exec(s))) {
        const src = M[Number(mm[1])];
        return { team: src && src.winner, prov: src ? src.winnerProv : false, label: s };
      }
      if ((mm = /^Loser(?:s)? Match (\d+)$/i.exec(s))) {
        const src = M[Number(mm[1])];
        return { team: src && src.loser, prov: src ? src.winnerProv : false, label: s };
      }
      if (TEAM_CODES[s]) return { team: s, prov: false, label: s }; // a literal host team (e.g. Mexico)
      return { team: null, prov: false, label: s };
    };

    // Resolve round by round so winners propagate into the next round's slots.
    const order = [32, 16, 125, 150, 160, 200];
    for (const round of order) {
      const ms = Object.values(M).filter((x) => x.round === round);
      for (const x of ms) {
        x.home = resolveSlot(x.homeLabel);
        x.away = resolveSlot(x.awayLabel);
      }
      // Overlay any live fixtures for this round by team-name set.
      for (const e of koByRound.get(round) || []) {
        const eh = e.strHomeTeam, ea = e.strAwayTeam;
        if (!eh || !ea) continue;
        const target = ms.find((x) => {
          const set = new Set([x.home.team, x.away.team]);
          return set.has(eh) && set.has(ea);
        });
        if (!target) continue;
        // Align home/away to the fixture's orientation.
        target.home = { team: eh, prov: false, label: target.homeLabel, badge: e.strHomeTeamBadge };
        target.away = { team: ea, prov: false, label: target.awayLabel, badge: e.strAwayTeamBadge };
        target.hs = e.intHomeScore;
        target.as = e.intAwayScore;
        target.status = e.strStatus || "";
        target.state = this._state(e);
        if (e.strTimestamp) target.ts = e.strTimestamp;
      }
      // Decide winner/loser for finished ties so the next round can resolve.
      for (const x of ms) {
        if (x.state === "final") {
          const hs = Number(x.hs), as = Number(x.as);
          if (!Number.isNaN(hs) && !Number.isNaN(as) && hs !== as && x.home.team && x.away.team) {
            const homeWon = hs > as;
            x.winner = homeWon ? x.home.team : x.away.team;
            x.loser = homeWon ? x.away.team : x.home.team;
            x.winnerProv = false;
          }
        }
      }
    }
    return M;
  }

  _touchUpdatedLine() {
    const el = this.shadowRoot.querySelector(".updated");
    if (el) {
      el.textContent = this._updatedText();
      el.classList.toggle("rate-limited", this._rateLimited);
    }
  }

  _updatedText() {
    if (this._rateLimited) {
      return this._lastFetch
        ? `Rate limited · last updated ${this._fmtUpdated(this._lastFetch)} · TheSportsDB`
        : `Rate limited · TheSportsDB`;
    }
    return `Updated ${this._fmtUpdated(this._lastFetch || new Date())} · TheSportsDB`;
  }

  _fmtUpdated(d) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  _kickoff(e) {
    if (e.strTimestamp) {
      const t = Date.parse(e.strTimestamp + "Z");
      if (!isNaN(t)) return t;
    }
    const t2 = Date.parse(`${e.dateEvent}T${e.strTime || "00:00:00"}Z`);
    return isNaN(t2) ? 0 : t2;
  }

  // For a static bracket match, kickoff comes straight from its naive-UTC ts.
  _matchKickoff(x) {
    const t = Date.parse(x.ts + "Z");
    return isNaN(t) ? 0 : t;
  }

  _state(e) {
    const s = (e.strStatus || "").trim();
    const hasScore = e.intHomeScore !== null && e.intHomeScore !== "" && e.intHomeScore !== undefined;
    if (FINISHED.has(s)) return "final";
    if (NOT_STARTED.has(s) || (!s && !hasScore)) return "upcoming";
    if (hasScore) return "live";
    return "upcoming";
  }

  _render() {
    const css = `
      :host { --wc-accent: var(--primary-color, #03a9f4); --wc-line: var(--divider-color, rgba(127,127,127,.4)); }
      ha-card { padding: 0; overflow: hidden; }
      .header { display:flex; align-items:center; gap:8px; padding:14px 16px 6px; font-size:1.35em; font-weight:600; }
      .header .logo { --mdc-icon-size: 24px; color: var(--wc-accent); }
      .scroller { overflow-x: auto; overflow-y: hidden; padding: 10px 14px 6px; }
      /* Centre the bracket when the card is wider than it needs (full-width
         placement); fall back to horizontal scroll when it's narrower. */
      .scroller { display: flex; justify-content: center; }
      .bracket { display: inline-flex; align-items: stretch; min-width: min-content; }
      .half { display: flex; align-items: center; }
      .center { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 0 6px; }

      /* Recursive node: a match cell next to the column of its two feeders.
         align-items:center vertically centres each parent against its children. */
      .node { display: flex; align-items: center; }
      .right .node { flex-direction: row-reverse; }
      .kids { display: flex; flex-direction: column; justify-content: center; position: relative; }
      .self { position: relative; }
      .left .self { margin-left: 22px; }
      .right .self { margin-right: 22px; }

      /* Connectors: a vertical line joining a pair of feeders, and a horizontal
         stub from each match to its feeders' vertical line. */
      .left .kids:not(.leafrow)::after { content:''; position:absolute; right:0; top:25%; bottom:25%; width:2px; background:var(--wc-line); }
      .right .kids:not(.leafrow)::before { content:''; position:absolute; left:0; top:25%; bottom:25%; width:2px; background:var(--wc-line); }
      .left .node:not(.leaf) > .self::before { content:''; position:absolute; left:-22px; top:50%; width:22px; height:2px; background:var(--wc-line); }
      .right .node:not(.leaf) > .self::after { content:''; position:absolute; right:-22px; top:50%; width:22px; height:2px; background:var(--wc-line); }

      .cell { width: 108px; box-sizing: border-box; border:1px solid var(--wc-line); border-radius:7px; margin:5px 0;
        background: var(--card-background-color, var(--ha-card-background, #1c1c1c)); overflow:hidden; }
      .cell .meta { font-size:8.5px; font-weight:700; letter-spacing:.02em; text-transform:uppercase; color: var(--secondary-text-color);
        padding:2px 6px; border-bottom:1px solid var(--wc-line); display:flex; justify-content:space-between; gap:4px; white-space:nowrap; }
      .row { display:flex; align-items:center; gap:6px; padding:4px 6px; }
      .row + .row { border-top:1px dashed var(--divider-color, rgba(127,127,127,.18)); }
      .row .code { font-size:12px; font-weight:700; letter-spacing:.4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .row .sc { margin-left:auto; font-variant-numeric:tabular-nums; font-weight:800; font-size:12px; min-width:10px; text-align:right; }
      .row.win .code { color: var(--wc-accent); }
      .row.win .sc { color: var(--wc-accent); }
      .row.prov .code { font-style:italic; opacity:.72; border-bottom:1px dotted currentColor; }
      .cell.live { border-color: var(--error-color, #e53935); box-shadow:0 0 0 1px var(--error-color, #e53935); }
      .cell.final-cup { width: 134px; }
      .cell.final-cup .meta { color: var(--wc-accent); }
      .center .label { font-size:.62em; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color: var(--secondary-text-color); text-align:center; }
      .center .third { opacity:.92; }

      .colheads { display:flex; padding:2px 14px 0; gap:0; }
      .updated { text-align:center; font-size:.68em; color: var(--secondary-text-color); padding:10px 0 8px; }
      .updated.rate-limited { color: var(--warning-color, #e5a50a); }
      .msg { padding: 24px 16px; text-align:center; color: var(--secondary-text-color); }
    `;

    let body;
    if (this._loading) {
      body = `<div class="msg">Loading bracket…</div>`;
    } else if (this._error) {
      body = `<div class="msg">⚠️ Could not load bracket<br><span style="font-size:.8em">${this._esc(this._error)}</span></div>`;
    } else {
      // Each half is wrapped in .half .left/.right — the side class drives the
      // mirroring (row-reverse on the right) and the connector lines.
      const left = `<div class="half left">${this._renderNode(101, "left")}</div>`;
      const right = `<div class="half right">${this._renderNode(102, "right")}</div>`;
      const center = this._renderCenter();
      body = `<div class="scroller"><div class="bracket">${left}${center}${right}</div></div>`;
    }

    const titlePart = this._config.title
      ? `<ha-icon class="logo" icon="mdi:tournament"></ha-icon><span>${this._esc(this._config.title)}</span>`
      : "";
    const header = this._config.title ? `<div class="header">${titlePart}</div>` : "";
    const updated = !this._loading && !this._error
      ? `<div class="updated${this._rateLimited ? " rate-limited" : ""}">${this._updatedText()}</div>`
      : "";

    const prev = this.shadowRoot.querySelector(".scroller");
    const prevLeft = prev ? prev.scrollLeft : null;

    this.shadowRoot.innerHTML = `<style>${css}</style><ha-card>${header}${body}${updated}</ha-card>`;

    const scroller = this.shadowRoot.querySelector(".scroller");
    if (prevLeft != null && scroller) scroller.scrollLeft = prevLeft;
  }

  // Recursively render a match and its feeder subtree. `side` is "left"/"right".
  _renderNode(m, side) {
    const kids = CHILDREN[m];
    const leaf = !kids;
    const kidsHtml = leaf
      ? `<div class="kids leafrow"></div>`
      : `<div class="kids">${kids.map((c) => this._renderNode(c, side)).join("")}</div>`;
    const self = `<div class="self">${this._renderCell(this._matches[m])}</div>`;
    return `<div class="node ${leaf ? "leaf" : ""}">${kidsHtml}${self}</div>`;
  }

  _renderCenter() {
    const final = this._matches[104];
    const third = this._matches[103];
    return `<div class="center">
      <div>
        <div class="label">Final</div>
        ${this._renderCell(final, true)}
      </div>
      <div class="third">
        <div class="label">Third place</div>
        ${this._renderCell(third)}
      </div>
    </div>`;
  }

  _renderCell(x, isFinal) {
    const ko = this._matchKickoff(x);
    const when = `${this._dowShort(ko)} ${this._fmtTime(new Date(ko))}`;
    const title = `${ROUND_NAME[x.round] || ""} · Match ${x.m}\n${new Date(ko).toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}\n${x.venue}`;
    const metaRight = x.state === "live" ? `<span style="color:var(--error-color,#e53935)">LIVE</span>` : when;
    const meta = `<div class="meta" title="${this._esc(title)}"><span>M${x.m}</span><span>${this._esc(metaRight)}</span></div>`;

    const side = (p, score) => {
      const isWin = x.winner && p.team && x.winner === p.team;
      const display = p.team ? this._code(p.team) : this._code(p.label);
      // Tooltip is the full team name; flag provisional picks so it's explicit
      // that the group isn't decided yet (matches the italic/dotted styling).
      const full = (p.team || p.label) + (p.prov && p.team ? " (Provisional)" : "");
      const sc = (score === null || score === undefined || score === "") ? "" : this._esc(score);
      const cls = ["row", isWin ? "win" : "", p.prov ? "prov" : ""].filter(Boolean).join(" ");
      return `<div class="${cls}" title="${this._esc(full)}"><span class="code">${this._esc(display)}</span><span class="sc">${sc}</span></div>`;
    };

    const cls = ["cell", x.state === "live" ? "live" : "", isFinal ? "final-cup" : ""].filter(Boolean).join(" ");
    return `<div class="${cls}">${meta}${side(x.home, x.hs)}${side(x.away, x.as)}</div>`;
  }

  _dowShort(ts) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: "short" });
  }

  _fmtTime(d) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  _code(team) {
    if (!team) return "—";
    if (TEAM_CODES[team]) return TEAM_CODES[team];
    let mm;
    if ((mm = /^Winner(?:s)? Group ([A-L])$/i.exec(team))) return `1${mm[1].toUpperCase()}`;
    if ((mm = /^Runner(?:s)?-up Group ([A-L])$/i.exec(team))) return `2${mm[1].toUpperCase()}`;
    if (/^3rd Group/i.test(team)) return "3rd";
    if ((mm = /^Winner(?:s)? Match (\d+)$/i.exec(team))) return `W${mm[1]}`;
    if ((mm = /^Loser(?:s)? Match (\d+)$/i.exec(team))) return `L${mm[1]}`;
    const cleaned = team.replace(/[^A-Za-z]/g, "");
    return (cleaned.slice(0, 3) || team.slice(0, 3)).toUpperCase();
  }

  _esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
}

customElements.define("worldcup-bracket-card", WorldCupBracketCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "worldcup-bracket-card",
  name: "World Cup Bracket Card",
  description: "FIFA World Cup 2026 knockout bracket, self-populating from results and group standings.",
  preview: false,
});

console.info("%c WORLDCUP-BRACKET-CARD %c loaded ", "background:#03a9f4;color:#fff;border-radius:3px 0 0 3px;padding:2px 4px", "background:#222;color:#fff;border-radius:0 3px 3px 0;padding:2px 4px");
})();
