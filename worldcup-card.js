/**
 * World Cup Card — a custom Lovelace card for Home Assistant.
 *
 * Shows a grid of FIFA World Cup 2026 fixtures grouped by day. Played matches
 * display the final score, live matches show a pulsing LIVE badge with the
 * running score, and upcoming matches show the kickoff time in your local
 * timezone. Data comes from TheSportsDB's free public API (CORS-friendly, no
 * signup required), so the card runs entirely in the browser — no add-on or
 * backend needed.
 *
 * Install:
 *   1. Copy this file to  /config/www/worldcup-card.js
 *   2. Settings → Dashboards → ⋮ → Resources → Add Resource
 *        URL: /local/worldcup-card.js     Type: JavaScript Module
 *   3. Add a card to a dashboard with at minimum:
 *        type: custom:worldcup-card
 *
 * Full YAML options (all optional):
 *   type: custom:worldcup-card
 *   title: World Cup 2026     # card header; "" to hide
 *   full_schedule: true       # show EVERY match across the whole tournament (default)
 *   max_height: "640px"       # scrollable height for the long list ("" = no limit)
 *   days_back: 2              # rolling mode only: past days to include (if full_schedule:false)
 *   days_ahead: 7             # rolling mode only: upcoming days to include
 *   refresh: 120             # auto-refresh interval in seconds (min 30)
 *   team: ""                 # only show matches involving this team (substring, e.g. "USA")
 *   season: "2026"           # tournament season
 *   league_id: "4429"        # TheSportsDB league id (4429 = FIFA World Cup)
 *   rounds: [1,2,3,32,16,125,150,160,200]  # group MD1-3, R32, R16, QF, SF, 3rd, Final
 *   api_key: "123"           # TheSportsDB free test key; replace with your own if you have one
 *   compact: false           # hide venue line for a denser grid
 *
 * Data is fetched by ROUND (eventsround), not by day: the free per-day endpoint
 * silently truncates busy match days, while the round endpoint returns every
 * fixture. Knockout rounds are empty until the bracket is drawn and then fill in
 * automatically. Finished rounds are cached in the browser, so steady-state
 * refreshes only re-poll the in-progress and not-yet-scheduled rounds.
 */

// Wrapped in an IIFE so the top-level consts (DEFAULTS, TEAM_CODES, …) stay
// local. That lets this and the standings card load as plain <script> tags on
// the same page (e.g. the standalone index.html opened via file://) without
// their identically-named globals colliding. Harmless under Home Assistant,
// which loads each card as its own module.
(() => {
const DEFAULTS = {
  title: "World Cup 2026",
  full_schedule: true,
  max_height: "640px",
  days_back: 2,
  days_ahead: 7,
  refresh: 120,
  team: "",
  season: "2026",
  league_id: "4429",
  // Group matchdays 1-3, then Round of 32, Round of 16, Quarter-finals (125),
  // Semi-finals (150), Third-place (160), Final (200). Codes verified against
  // TheSportsDB's FIFA World Cup data.
  rounds: [1, 2, 3, 32, 16, 125, 150, 160, 200],
  api_key: "123",
  compact: false,
};

// Status strings TheSportsDB uses for finished / not-started matches.
const FINISHED = new Set(["FT", "AET", "PEN", "Match Finished", "AP", "FT_PEN"]);
const NOT_STARTED = new Set(["NS", "", "Not Started", "TBD", "Time To Be Defined", null, undefined]);

// FIFA 3-letter country codes, keyed by the exact team name TheSportsDB returns.
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

// FIFA 2026 knockout schedule — fixed dates/times/venues, published long before
// the teams are known. TheSportsDB's free feed doesn't carry these fixtures until
// the bracket fills, so we ship them as a static fallback: the card shows the
// kickoff time and the slot it'll be (e.g. "1A vs 2B") with placeholder names.
// As soon as the live feed starts returning real fixtures for a round, that round's
// real data takes over and these are dropped (see _fetch).
//
// `round` matches the round codes the card requests (32=R32, 16=R16, 125=QF,
// 150=SF, 160=third place, 200=final). `ts` is UTC (kickoff converted from the
// venue's local time), the same naive-UTC format strTimestamp uses.
const KNOCKOUT_2026 = [
  // Round of 32
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
  // Round of 16
  { m: 89, round: 16, ts: "2026-07-04T21:00:00", venue: "Lincoln Financial Field, Philadelphia", home: "Winner Match 74", away: "Winner Match 77" },
  { m: 90, round: 16, ts: "2026-07-04T17:00:00", venue: "NRG Stadium, Houston", home: "Winner Match 73", away: "Winner Match 75" },
  { m: 91, round: 16, ts: "2026-07-05T20:00:00", venue: "MetLife Stadium, East Rutherford", home: "Winner Match 76", away: "Winner Match 78" },
  { m: 92, round: 16, ts: "2026-07-06T00:00:00", venue: "Estadio Azteca, Mexico City", home: "Winner Match 79", away: "Winner Match 80" },
  { m: 93, round: 16, ts: "2026-07-06T19:00:00", venue: "AT&T Stadium, Arlington", home: "Winner Match 83", away: "Winner Match 84" },
  { m: 94, round: 16, ts: "2026-07-07T00:00:00", venue: "Lumen Field, Seattle", home: "Winner Match 81", away: "Winner Match 82" },
  { m: 95, round: 16, ts: "2026-07-07T16:00:00", venue: "Mercedes-Benz Stadium, Atlanta", home: "Winner Match 86", away: "Winner Match 88" },
  { m: 96, round: 16, ts: "2026-07-07T20:00:00", venue: "BC Place, Vancouver", home: "Winner Match 85", away: "Winner Match 87" },
  // Quarter-finals
  { m: 97, round: 125, ts: "2026-07-09T20:00:00", venue: "Gillette Stadium, Foxborough", home: "Winner Match 89", away: "Winner Match 90" },
  { m: 98, round: 125, ts: "2026-07-10T19:00:00", venue: "SoFi Stadium, Inglewood", home: "Winner Match 93", away: "Winner Match 94" },
  { m: 99, round: 125, ts: "2026-07-11T21:00:00", venue: "Hard Rock Stadium, Miami Gardens", home: "Winner Match 91", away: "Winner Match 92" },
  { m: 100, round: 125, ts: "2026-07-12T01:00:00", venue: "Arrowhead Stadium, Kansas City", home: "Winner Match 95", away: "Winner Match 96" },
  // Semi-finals
  { m: 101, round: 150, ts: "2026-07-14T19:00:00", venue: "AT&T Stadium, Arlington", home: "Winner Match 97", away: "Winner Match 98" },
  { m: 102, round: 150, ts: "2026-07-15T19:00:00", venue: "Mercedes-Benz Stadium, Atlanta", home: "Winner Match 99", away: "Winner Match 100" },
  // Third-place play-off
  { m: 103, round: 160, ts: "2026-07-18T21:00:00", venue: "Hard Rock Stadium, Miami Gardens", home: "Loser Match 101", away: "Loser Match 102" },
  // Final
  { m: 104, round: 200, ts: "2026-07-19T19:00:00", venue: "MetLife Stadium, East Rutherford", home: "Winner Match 101", away: "Winner Match 102" },
];

// Expand a static knockout entry into the same event shape the API returns, so it
// flows through every downstream path (state, kickoff, grouping, render) unchanged.
function knockoutEvent(k) {
  return {
    idEvent: `wc-ko-${k.m}`,
    intRound: String(k.round),
    strTimestamp: k.ts,
    dateEvent: k.ts.slice(0, 10),
    strTime: k.ts.slice(11),
    strHomeTeam: k.home,
    strAwayTeam: k.away,
    strVenue: k.venue,
    strStatus: "NS",
    strProgress: "",
    intHomeScore: null,
    intAwayScore: null,
    strGroup: "", // knockout ties have no group chip
    strHomeTeamBadge: "",
    strAwayTeamBadge: "",
  };
}

class WorldCupCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { ...DEFAULTS };
    this._events = null;
    this._error = null;
    this._loading = true;
    this._lastSig = null;
    this._timer = null;
    this._scrolledToToday = false;
    this._lastFetch = null; // time of the last *successful* (un-throttled) poll
    this._rateLimited = false;
  }

  _todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  setConfig(config) {
    this._config = { ...DEFAULTS, ...(config || {}) };
    this._config.refresh = Math.max(30, Number(this._config.refresh) || DEFAULTS.refresh);
    this._config.days_back = Math.max(0, Number(this._config.days_back) || 0);
    this._config.days_ahead = Math.max(0, Number(this._config.days_ahead) || 0);
    // If already connected, refetch with new settings.
    if (this.isConnected) {
      this._stop();
      this._start();
    }
  }

  // hass is set by Lovelace; we don't need it for data, but keep a reference
  // so theme variables resolve and the card is treated as valid.
  set hass(hass) {
    this._hass = hass;
  }

  getCardSize() {
    return 8;
  }

  static getStubConfig() {
    return { type: "custom:worldcup-card" };
  }

  connectedCallback() {
    // Re-scroll to today each time the card mounts (load, page refresh, or
    // navigating back to the dashboard).
    this._scrolledToToday = false;
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

  // --- per-round browser cache --------------------------------------------
  // A round is cached "final" only once every fixture in it has finished; until
  // then it's re-fetched each refresh so live scores update.
  _cacheKey(round) {
    return `wc-card:r:${this._config.league_id}:${this._config.season}:${round}`;
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
    if (cached && cached.final) return cached.events; // completed round — never refetch
    const { api_key, league_id, season } = this._config;
    try {
      const r = await fetch(
        `https://www.thesportsdb.com/api/v1/json/${api_key}/eventsround.php?id=${league_id}&r=${round}&s=${encodeURIComponent(season)}`
      );
      if (!r.ok) {
        if (r.status === 429) this._rateLimited = true; // throttled — flag it, keep cache
        return cached ? cached.events : [];
      }
      const j = await r.json();
      const events = j.events || [];
      // "final" = at least one fixture and all of them finished.
      const final =
        events.length > 0 && events.every((e) => this._state(e) === "final");
      this._cacheSet(round, { final, events });
      return events;
    } catch (e) {
      return cached ? cached.events : []; // fall back to any cached copy
    }
  }

  // Run async tasks with a concurrency cap so we don't fire every round request
  // at the shared free API simultaneously.
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

  _windowFilter(events) {
    // In rolling mode, keep only matches within [today-days_back, today+days_ahead].
    if (this._config.full_schedule) return events;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - this._config.days_back).getTime();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + this._config.days_ahead + 1).getTime();
    return events.filter((e) => {
      const k = this._kickoff(e);
      return k >= start && k < end;
    });
  }

  async _fetch() {
    const rounds = Array.isArray(this._config.rounds) ? this._config.rounds : DEFAULTS.rounds;
    this._rateLimited = false; // _fetchRound flips this if any round gets a 429
    try {
      const results = await this._pool(rounds, 5, (r) => this._fetchRound(r));
      // Only advance the "last updated" stamp on a clean poll; a throttled one
      // keeps the previous successful time and shows "Rate limited" instead.
      if (!this._rateLimited) this._lastFetch = new Date();
      // Flatten + dedupe by event id. Track which rounds the live feed actually
      // covered so we know where the static knockout fallback is still needed.
      const seen = new Set();
      const liveRounds = new Set();
      let events = [];
      results.forEach((list, idx) => {
        if (list && list.length) liveRounds.add(Number(rounds[idx]));
        for (const e of list || []) {
          const id = e.idEvent || `${e.dateEvent}-${e.strEvent}`;
          if (seen.has(id)) continue;
          seen.add(id);
          events.push(e);
        }
      });

      // Static knockout fallback: for any requested knockout round the feed
      // returned nothing for, fill in the fixed FIFA schedule (times/venues/slots)
      // with placeholder team names. Real fixtures supersede these per round.
      const wantRounds = new Set(rounds.map(Number));
      for (const k of KNOCKOUT_2026) {
        if (wantRounds.has(k.round) && !liveRounds.has(k.round)) {
          events.push(knockoutEvent(k));
        }
      }

      events = this._windowFilter(events);

      if (this._config.team) {
        const t = this._config.team.toLowerCase();
        events = events.filter(
          (e) =>
            (e.strHomeTeam || "").toLowerCase().includes(t) ||
            (e.strAwayTeam || "").toLowerCase().includes(t)
        );
      }

      events.sort((a, b) => this._kickoff(a) - this._kickoff(b));

      this._events = events;
      this._error = null;
      this._loading = false;

      // Avoid pointless re-renders (which would restart CSS pulse animations).
      const sig = JSON.stringify(
        events.map((e) => [e.idEvent, e.intHomeScore, e.intAwayScore, e.strStatus, e.strProgress])
      );
      if (sig !== this._lastSig) {
        this._lastSig = sig;
        this._render();
      } else {
        // No content change: refresh just the "Updated" stamp in place so it
        // always reflects the most recent API poll.
        this._touchUpdatedLine();
      }
    } catch (err) {
      this._lastFetch = new Date();
      this._error = err && err.message ? err.message : String(err);
      this._loading = false;
      this._render();
    }
  }

  _touchUpdatedLine() {
    const el = this.shadowRoot.querySelector(".updated");
    if (el) {
      el.textContent = this._updatedText();
      el.classList.toggle("rate-limited", this._rateLimited);
    }
  }

  // Text for the footer line: normally "Updated <time>", but when the last poll
  // was throttled we say so and keep showing the last good sync time.
  _updatedText() {
    if (this._rateLimited) {
      return this._lastFetch
        ? `Rate limited · last updated ${this._fmtUpdated(this._lastFetch)} · TheSportsDB`
        : `Rate limited · TheSportsDB`;
    }
    return `Updated ${this._fmtUpdated(this._lastFetch || new Date())} · TheSportsDB`;
  }

  _fmtUpdated(d) {
    // Include seconds so you can see where you are in the refresh window.
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  _kickoff(e) {
    // strTimestamp is UTC without a zone marker; treat it as UTC.
    if (e.strTimestamp) {
      const t = Date.parse(e.strTimestamp + "Z");
      if (!isNaN(t)) return t;
    }
    const t2 = Date.parse(`${e.dateEvent}T${e.strTime || "00:00:00"}Z`);
    return isNaN(t2) ? 0 : t2;
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
      :host { --wc-accent: var(--primary-color, #03a9f4); }
      ha-card { padding: 0; overflow: hidden; }
      .wrap { padding: 8px 12px 14px; }
      .header { display:flex; align-items:center; gap:8px; padding:14px 16px 6px; font-size:1.35em; font-weight:600; }
      .header .logo { --mdc-icon-size: 24px; color: var(--wc-accent); }
      .today-btn { margin-left:8px; flex:0 0 auto; font-family:inherit; font-size:.55em; font-weight:700;
        letter-spacing:.03em; cursor:pointer; border:none; border-radius:16px; padding:6px 12px 6px 9px;
        display:inline-flex; align-items:center; gap:3px; background: var(--wc-accent);
        color: var(--text-primary-color, #fff); }
      .today-btn ha-icon { --mdc-icon-size: 15px; }
      .today-btn:hover { filter: brightness(1.08); }
      .today-btn:active { transform: translateY(1px); }
      .day { margin-top: 14px; }
      .day:first-child { margin-top: 6px; }
      .day-label { font-size:.8em; font-weight:700; letter-spacing:.04em; text-transform:uppercase;
        color: var(--secondary-text-color); padding: 8px 4px 6px; position:sticky; top:0; z-index:2;
        background: var(--card-background-color, var(--ha-card-background, #1c1c1c)); }
      .grid { display:grid; grid-template-columns: 1fr; gap:8px; }
      .match { display:grid; grid-template-columns: 1fr auto 1fr; align-items:center; gap:6px;
        background: var(--secondary-background-color, rgba(127,127,127,.08));
        border-radius:12px; padding:10px 12px; }
      .match.live { box-shadow: inset 0 0 0 2px var(--error-color, #e53935); }
      .team { display:flex; align-items:center; gap:8px; min-width:0; cursor:default; }
      .team.away { flex-direction: row-reverse; text-align:right; }
      .team img { width:26px; height:26px; object-fit:contain; flex:0 0 26px;
        background:#fff; border-radius:4px; }
      .team .name { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .team .code { letter-spacing:.5px; }
      .team .full { display:none; }
      /* On hover, swap code -> full name on a single line. It extends through
         the open vertical gap in the center column (see .mid gap) so it sits
         between the score/time and the day/Final badge without overlapping. */
      .team:hover .code { display:none; }
      .team:hover .full { display:inline; }
      .team:hover .name { overflow:visible; }
      .mid { display:flex; flex-direction:column; align-items:center; min-width:64px; gap:22px; }
      .score { font-size:1.25em; font-weight:800; font-variant-numeric: tabular-nums; letter-spacing:1px; }
      .score.dim { color: var(--secondary-text-color); }
      .time { font-size:.95em; font-weight:700; }
      .badge { font-size:.62em; font-weight:800; letter-spacing:.06em; text-transform:uppercase;
        padding:1px 6px; border-radius:8px; }
      .badge.final { background: var(--divider-color, rgba(127,127,127,.25)); color: var(--secondary-text-color); }
      .badge.live { background: var(--error-color, #e53935); color:#fff; animation: pulse 1.4s ease-in-out infinite; }
      .liveline { display:flex; align-items:center; gap:6px; font-size:.8em; }
      .liveline .min { font-weight:800; font-variant-numeric: tabular-nums; color: var(--error-color, #e53935); }
      .venue { grid-column: 1 / -1; font-size:.72em; color: var(--secondary-text-color);
        margin-top:2px; display:flex; align-items:center; gap:6px; }
      .venue .meta-left { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .venue .kt { margin-left:auto; flex:0 0 auto; font-weight:700; }
      .venue .grp { display:inline-block; padding:0 6px; border-radius:8px; font-weight:700;
        letter-spacing:.02em; background: var(--secondary-background-color, rgba(127,127,127,.16));
        color: var(--wc-accent); }
      .venue .sep { opacity:.5; margin:0 5px; }
      .scroller { overflow-y: auto; scroll-behavior: smooth; }
      .count { font-size:.6em; font-weight:600; color: var(--secondary-text-color); margin-left:auto; }
      .meta { font-size:.7em; color: var(--secondary-text-color); }
      .msg { padding: 24px 16px; text-align:center; color: var(--secondary-text-color); }
      .updated { text-align:center; font-size:.68em; color: var(--secondary-text-color); padding:10px 0 2px; }
      .updated.rate-limited { color: var(--warning-color, #e5a50a); }
      @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.45} }
      @media (min-width: 500px) { .grid { grid-template-columns: 1fr 1fr; } }
    `;

    let body;
    if (this._loading) {
      body = `<div class="msg">Loading fixtures…</div>`;
    } else if (this._error) {
      body = `<div class="msg">⚠️ Could not load fixtures<br><span class="meta">${this._esc(this._error)}</span></div>`;
    } else if (!this._events || this._events.length === 0) {
      body = `<div class="msg">No matches in this window.${this._config.team ? " (filter: " + this._esc(this._config.team) + ")" : ""}</div>`;
    } else {
      body = this._renderGroups();
    }

    const hasEvents = this._events && this._events.length;
    const count = hasEvents ? `<span class="count">${this._events.length} matches</span>` : "";
    const todayBtn = hasEvents
      ? `<button class="today-btn" type="button" title="Jump to today"><ha-icon icon="mdi:calendar-today"></ha-icon>Today</button>`
      : "";
    const titlePart = this._config.title
      ? `<ha-icon class="logo" icon="mdi:soccer"></ha-icon><span>${this._esc(this._config.title)}</span>`
      : "";
    const header = (this._config.title || hasEvents)
      ? `<div class="header">${titlePart}${count}${todayBtn}</div>`
      : "";

    const updated = !this._loading && !this._error
      ? `<div class="updated${this._rateLimited ? " rate-limited" : ""}">${this._updatedText()}</div>`
      : "";

    const mh = this._config.max_height;
    const scrollStyle = mh ? ` style="max-height:${this._esc(mh)}"` : "";
    const wrapInner = `<div class="scroller"${scrollStyle}>${body}</div>`;

    // Remember the current scroll position so a live-score re-render doesn't
    // yank the view back to the top.
    const prev = this.shadowRoot.querySelector(".scroller");
    const prevScroll = prev ? prev.scrollTop : null;

    this.shadowRoot.innerHTML =
      `<style>${css}</style><ha-card>${header}<div class="wrap">${wrapInner}${updated}</div></ha-card>`;

    const btn = this.shadowRoot.querySelector(".today-btn");
    if (btn) btn.addEventListener("click", () => this._scrollToToday());

    const scroller = this.shadowRoot.querySelector(".scroller");
    if (!this._scrolledToToday && this._events && this._events.length) {
      // On load / page refresh, bring today's matches into view (once per mount).
      this._scrolledToToday = true;
      // Two frames so sticky headers and badge images settle before measuring.
      requestAnimationFrame(() => requestAnimationFrame(() => this._scrollToToday()));
    } else if (prevScroll != null && scroller) {
      // Subsequent re-render (e.g. the auto-refresh updating a score): keep the
      // user exactly where they were. Restore instantly (no smooth animation),
      // and again on the next frame so late layout — like lazy-loaded badge
      // images — can't nudge us back toward the top.
      this._jump(scroller, prevScroll);
      requestAnimationFrame(() => {
        const s = this.shadowRoot.querySelector(".scroller");
        if (s) this._jump(s, prevScroll);
      });
    }
  }

  // Set scrollTop without triggering the CSS smooth-scroll animation.
  _jump(scroller, top) {
    const behavior = scroller.style.scrollBehavior;
    scroller.style.scrollBehavior = "auto";
    scroller.scrollTop = top;
    scroller.style.scrollBehavior = behavior;
  }

  _scrollToToday() {
    const scroller = this.shadowRoot.querySelector(".scroller");
    if (!scroller) return;
    const days = [...this.shadowRoot.querySelectorAll(".day")];
    if (!days.length) return;
    const today = this._todayISO();
    // Prefer today; otherwise the next upcoming day; otherwise the last day.
    const target =
      days.find((d) => d.dataset.date === today) ||
      days.find((d) => d.dataset.date > today) ||
      days[days.length - 1];
    if (!target) return;
    // Scroll only the inner container, never the whole page.
    const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop += delta;
  }

  _renderGroups() {
    // Group by LOCAL calendar day so kickoff times read naturally.
    const groups = new Map();
    for (const e of this._events) {
      const d = new Date(this._kickoff(e));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const keys = [...groups.keys()].sort();
    return keys.map((k) => {
      const rows = groups.get(k).map((e) => this._renderMatch(e)).join("");
      return `<div class="day" data-date="${k}"><div class="day-label">${this._dayLabel(k)}</div><div class="grid">${rows}</div></div>`;
    }).join("");
  }

  _renderMatch(e) {
    const state = this._state(e);
    const hs = e.intHomeScore ?? "";
    const as = e.intAwayScore ?? "";
    let mid;
    if (state === "upcoming") {
      mid = `<div class="time">${this._fmtTime(new Date(this._kickoff(e)))}</div><div class="badge final">${this._dowShort(this._kickoff(e))}</div>`;
    } else if (state === "live") {
      // Pulsing LIVE badge plus the current minute, but only when the feed
      // provides a real numeric minute (strProgress, e.g. "63"). We deliberately
      // don't show the phase code (1H/HT/2H…) — the actual kickoff time is on
      // the meta line below instead.
      const prog = (e.strProgress || "").trim();
      const minLabel = /^\d+$/.test(prog) ? `${prog}'` : "";
      mid =
        `<div class="score">${hs}–${as}</div>` +
        `<div class="liveline"><span class="badge live">LIVE</span>` +
        (minLabel ? `<span class="min">${minLabel}</span>` : "") +
        `</div>`;
    } else {
      mid = `<div class="score">${hs}–${as}</div><div class="badge final">Final</div>`;
    }

    const badge = (url) =>
      url ? `<img src="${this._esc(url)}" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span style="width:26px"></span>`;

    // Show the 3-letter code; hovering expands it to the full country name,
    // which wraps within its own column (see CSS) so it never overlaps the
    // score/time/badge.
    const team = (name, side) => {
      const url = side === "home" ? e.strHomeTeamBadge : e.strAwayTeamBadge;
      return `<div class="team ${side}">${badge(url)}<span class="name"><span class="code">${this._esc(this._code(name))}</span><span class="full">${this._esc(name)}</span></span></div>`;
    };

    // Group-stage fixtures carry a single-letter strGroup ("A".."L"); knockout
    // ties don't, so the chip simply doesn't render for them. The group is
    // shown even in compact mode (it's tiny); the venue is hidden there.
    const grp = (e.strGroup || "").trim();
    const groupChip = /^[A-La-l]$/.test(grp) ? `<span class="grp">Group ${grp.toUpperCase()}</span>` : "";
    const venueText = !this._config.compact && e.strVenue ? `<span>${this._esc(e.strVenue)}</span>` : "";
    const leftParts = [groupChip, venueText].filter(Boolean);
    // For live and finished matches, show the kickoff time (labelled "Start:")
    // at the right end of this line. Upcoming matches already show it
    // prominently in the middle, so it's omitted here.
    const startTime = (state === "live" || state === "final")
      ? `<span class="kt">Start: ${this._fmtTime(new Date(this._kickoff(e)))}</span>`
      : "";
    const meta = (leftParts.length || startTime)
      ? `<div class="venue"><span class="meta-left">${leftParts.join('<span class="sep">·</span>')}</span>${startTime}</div>`
      : "";

    return `
      <div class="match ${state}">
        ${team(e.strHomeTeam, "home")}
        <div class="mid">${mid}</div>
        ${team(e.strAwayTeam, "away")}
        ${meta}
      </div>`;
  }

  _code(team) {
    if (!team) return "";
    if (TEAM_CODES[team]) return TEAM_CODES[team];
    // Knockout placeholder slots get a tidy short code instead of the generic
    // 3-letter fallback (the full label still shows on hover):
    //   "Winner Group E"   -> "1E"   "Runner-up Group B" -> "2B"
    //   "3rd Group A/B/.."  -> "3rd"  "Winner Match 73"   -> "W73"
    //   "Loser Match 101"   -> "L101"
    let mm;
    if ((mm = /^Winner(?:s)? Group ([A-L])$/i.exec(team))) return `1${mm[1].toUpperCase()}`;
    if ((mm = /^Runner(?:s)?-up Group ([A-L])$/i.exec(team))) return `2${mm[1].toUpperCase()}`;
    if (/^3rd Group/i.test(team)) return "3rd";
    if ((mm = /^Winner(?:s)? Match (\d+)$/i.exec(team))) return `W${mm[1]}`;
    if ((mm = /^Loser(?:s)? Match (\d+)$/i.exec(team))) return `L${mm[1]}`;
    // Generic fallback: first three letters, uppercased, non-letters stripped.
    const cleaned = team.replace(/[^A-Za-z]/g, "");
    return (cleaned.slice(0, 3) || team.slice(0, 3)).toUpperCase();
  }

  _dayLabel(key) {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date();
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diff = Math.round((date - t0) / 86400000);
    let prefix = "";
    if (diff === 0) prefix = "Today · ";
    else if (diff === 1) prefix = "Tomorrow · ";
    else if (diff === -1) prefix = "Yesterday · ";
    return prefix + date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }

  _dowShort(ts) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: "short" });
  }

  _fmtTime(d) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  _esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
}

customElements.define("worldcup-card", WorldCupCard);

// Register with the card picker so it shows up in the "Add Card" dialog.
window.customCards = window.customCards || [];
window.customCards.push({
  type: "worldcup-card",
  name: "World Cup Card",
  description: "FIFA World Cup 2026 schedule grid with live and final scores.",
  preview: false,
});

console.info("%c WORLDCUP-CARD %c loaded ", "background:#03a9f4;color:#fff;border-radius:3px 0 0 3px;padding:2px 4px", "background:#222;color:#fff;border-radius:0 3px 3px 0;padding:2px 4px");
})();
