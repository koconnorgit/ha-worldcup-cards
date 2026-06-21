/**
 * World Cup Standings Card — a custom Lovelace card for Home Assistant.
 *
 * A companion to worldcup-card.js. Shows up-to-date FIFA World Cup 2026 group
 * standings as one mini league table per group (Pos · Team · P W D L GF GA GD
 * Pts), with recent form and the qualifying positions highlighted.
 *
 * The tables are COMPUTED in the browser from the group-stage match results —
 * the same `eventsround` fixtures the schedule card loads — rather than read
 * from TheSportsDB's `lookuptable` endpoint, which lags badly early in the
 * tournament (it returned only the leader of each group on matchday 1). Working
 * from the fixtures gives complete, correct tables as soon as results come in.
 * It runs entirely in the browser — no add-on or backend, no signup required.
 *
 * Install:
 *   1. Copy this file to  /config/www/worldcup-standings-card.js
 *   2. Settings → Dashboards → ⋮ → Resources → Add Resource
 *        URL: /local/worldcup-standings-card.js   Type: JavaScript Module
 *   3. Add a card to a dashboard with at minimum:
 *        type: custom:worldcup-standings-card
 *
 * Full YAML options (all optional):
 *   type: custom:worldcup-standings-card
 *   title: "World Cup 2026 — Standings"  # card header; "" to hide
 *   max_height: "640px"      # scrollable height for the long list ("" = no limit)
 *   refresh: 120             # auto-refresh interval in seconds (min 30)
 *   group: ""                # only show one group (e.g. "A", "Group D" — substring match)
 *   highlight_top: 2         # rows ranked 1..N per group flagged as qualifiers (0 = off)
 *   show_form: true          # show the recent W/D/L form column
 *   include_live: false      # also count in-progress matches in the table
 *   compact: false           # drop W/D/L and GF/GA columns for a denser table
 *   season: "2026"           # tournament season
 *   league_id: "4429"        # TheSportsDB league id (4429 = FIFA World Cup)
 *   group_rounds: [1,2,3]    # round codes that make up the group stage
 *   api_key: "123"           # TheSportsDB free test key; replace with your own if you have one
 *
 * Like the schedule card, each round is cached in the browser once all its
 * fixtures finish, so steady-state refreshes only re-poll in-progress rounds,
 * and a throttled/failed poll falls back to the last cached results rather than
 * blanking the table.
 */

// Wrapped in an IIFE so the top-level consts (DEFAULTS, TEAM_CODES, FINISHED, …)
// stay local. That lets this and the schedule card load as plain <script> tags
// on the same page (e.g. the standalone index.html opened via file://) without
// their identically-named globals colliding. Harmless under Home Assistant,
// which loads each card as its own module.
(() => {
const DEFAULTS = {
  title: "World Cup 2026 — Standings",
  max_height: "640px",
  refresh: 120,
  group: "",
  highlight_top: 2,
  show_form: true,
  include_live: false,
  compact: false,
  season: "2026",
  league_id: "4429",
  group_rounds: [1, 2, 3],
  api_key: "123",
};

// Status strings TheSportsDB uses for finished / not-started matches.
const FINISHED = new Set(["FT", "AET", "PEN", "Match Finished", "AP", "FT_PEN"]);
const NOT_STARTED = new Set(["NS", "", "Not Started", "TBD", "Time To Be Defined", null, undefined]);

// FIFA 3-letter country codes, keyed by the exact team name TheSportsDB returns.
// (Kept in sync with worldcup-card.js.)
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

// Rank a group's teams by the FIFA 2026 group-stage tiebreakers, in order:
//   1. overall points
//   2. head-to-head points       ┐ a mini-league over only the matches played
//   3. head-to-head goal diff     │ between the teams that are level on points
//   4. head-to-head goals scored ┘
//   5. overall goal difference
//   6. overall goals scored
//   7. team name (stand-in for fair-play / FIFA-ranking / drawing of lots)
// For 2026 FIFA moved head-to-head ahead of overall goal difference, so a tie is
// settled by the results between the tied teams first. `rows` are the team stat
// objects; `matches` the counted group fixtures ({h,a,hs,as}); `nameOf(row)` the
// team name; `acc` reads each row's overall pts/gd/gf. The head-to-head step is
// reapplied to any subset that stays level, mirroring FIFA's procedure of
// re-running the H2H criteria on the teams still tied after the first pass.
// (Kept in sync with rankGroupTable in worldcup-bracket-card.js.)
function rankGroupTable(rows, matches, nameOf, acc) {
  const h2h = (subset) => {
    const names = new Set(subset.map(nameOf));
    const tbl = new Map();
    for (const n of names) tbl.set(n, { pts: 0, gd: 0, gf: 0 });
    for (const mt of matches) {
      if (!names.has(mt.h) || !names.has(mt.a)) continue;
      const H = tbl.get(mt.h), A = tbl.get(mt.a);
      H.gf += mt.hs; H.gd += mt.hs - mt.as;
      A.gf += mt.as; A.gd += mt.as - mt.hs;
      if (mt.hs > mt.as) H.pts += 3;
      else if (mt.hs < mt.as) A.pts += 3;
      else { H.pts++; A.pts++; }
    }
    return tbl;
  };
  const byOverall = (a, b) =>
    acc.gd(b) - acc.gd(a) || acc.gf(b) - acc.gf(a) ||
    String(nameOf(a)).localeCompare(String(nameOf(b)));
  // Order a block of teams already level on overall points.
  const breakTie = (block) => {
    if (block.length <= 1) return block;
    const tbl = h2h(block);
    const k = (r) => tbl.get(nameOf(r));
    const sorted = [...block].sort((a, b) => {
      const A = k(a), B = k(b);
      return B.pts - A.pts || B.gd - A.gd || B.gf - A.gf;
    });
    const out = [];
    let i = 0;
    while (i < sorted.length) {
      const A = k(sorted[i]);
      let j = i + 1;
      while (j < sorted.length) {
        const B = k(sorted[j]);
        if (B.pts === A.pts && B.gd === A.gd && B.gf === A.gf) j++;
        else break;
      }
      const sub = sorted.slice(i, j);
      if (sub.length === 1) out.push(sub[0]);
      else if (sub.length === block.length) out.push(...sub.sort(byOverall)); // H2H separated nothing
      else out.push(...breakTie(sub)); // reapply H2H to the still-level subset
      i = j;
    }
    return out;
  };
  // Split into equal-points blocks, then break ties within each.
  const byPts = [...rows].sort((a, b) => acc.pts(b) - acc.pts(a));
  const result = [];
  let i = 0;
  while (i < byPts.length) {
    let j = i + 1;
    while (j < byPts.length && acc.pts(byPts[j]) === acc.pts(byPts[i])) j++;
    result.push(...breakTie(byPts.slice(i, j)));
    i = j;
  }
  return result;
}

class WorldCupStandingsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { ...DEFAULTS };
    this._groupsData = null; // [{ group, rows:[...] }]
    this._error = null;
    this._loading = true;
    this._lastSig = null;
    this._timer = null;
    this._lastFetch = null; // time of the last *successful* (un-throttled) poll
    this._rateLimited = false;
  }

  setConfig(config) {
    this._config = { ...DEFAULTS, ...(config || {}) };
    this._config.refresh = Math.max(30, Number(this._config.refresh) || DEFAULTS.refresh);
    this._config.highlight_top = Math.max(0, Number(this._config.highlight_top) || 0);
    if (!Array.isArray(this._config.group_rounds)) this._config.group_rounds = DEFAULTS.group_rounds;
    if (this.isConnected) {
      this._stop();
      this._start();
    }
  }

  // hass is set by Lovelace; we don't need it for data, but keep a reference so
  // theme variables resolve and the card is treated as valid.
  set hass(hass) {
    this._hass = hass;
  }

  getCardSize() {
    return 8;
  }

  static getStubConfig() {
    return { type: "custom:worldcup-standings-card" };
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

  // --- per-round browser cache (mirrors worldcup-card.js) ------------------
  // A round is cached "final" only once every fixture in it has finished; until
  // then it's re-fetched each refresh so the table tracks live results. A
  // throttled/failed poll falls back to whatever copy is cached.
  _cacheKey(round) {
    return `wc-standings:r:${this._config.league_id}:${this._config.season}:${round}`;
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
      const final = events.length > 0 && events.every((e) => this._state(e) === "final");
      this._cacheSet(round, { final, events });
      return events;
    } catch (e) {
      return cached ? cached.events : []; // network failure — fall back to cache
    }
  }

  // Concurrency-capped fan-out so we don't fire every round at the free API at
  // once.
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
    const rounds = this._config.group_rounds;
    this._rateLimited = false; // _fetchRound flips this if any round gets a 429
    try {
      const results = await this._pool(rounds, 5, (r) => this._fetchRound(r));
      // Only advance the "last updated" stamp on a clean poll; a throttled one
      // keeps the previous successful time and shows "Rate limited" instead.
      if (!this._rateLimited) this._lastFetch = new Date();

      // Flatten + dedupe by event id.
      const seen = new Set();
      const events = [];
      for (const list of results) {
        for (const e of list || []) {
          const id = e.idEvent || `${e.dateEvent}-${e.strEvent}`;
          if (seen.has(id)) continue;
          seen.add(id);
          events.push(e);
        }
      }

      const groups = this._computeStandings(events);

      // Don't let an empty fetch (throttle with no cache) wipe a good table.
      if (groups.length === 0 && this._groupsData && this._groupsData.length) {
        this._touchUpdatedLine();
        return;
      }

      this._groupsData = groups;
      this._error = null;
      this._loading = false;

      const sig = JSON.stringify(
        groups.map((g) => [g.group, g.rows.map((r) => [r.strTeam, r.intRank, r.intPlayed, r.intPoints, r.intGoalDifference, r.strForm])])
      );
      if (sig !== this._lastSig) {
        this._lastSig = sig;
        this._render();
      } else {
        this._touchUpdatedLine();
      }
    } catch (err) {
      this._lastFetch = new Date();
      if (this._groupsData && this._groupsData.length) {
        this._touchUpdatedLine(); // keep the last good table on screen
      } else {
        this._error = err && err.message ? err.message : String(err);
        this._loading = false;
        this._render();
      }
    }
  }

  // Build group tables from fixtures. Counts finished matches (and in-progress
  // ones too when include_live is set), then ranks each group by the FIFA 2026
  // tiebreakers via rankGroupTable: points → head-to-head (points, GD, GF among
  // the tied teams) → overall GD → overall GF → name.
  _computeStandings(events) {
    const countLive = this._config.include_live;
    // group -> (team -> stats)
    const groups = new Map();
    // group -> [{h,a,hs,as}] of counted matches, for head-to-head tiebreaks
    const matches = new Map();

    const teamStat = (g, name, badge) => {
      if (!groups.has(g)) groups.set(g, new Map());
      const m = groups.get(g);
      if (!m.has(name)) {
        m.set(name, {
          strTeam: name, strBadge: badge || "", strGroup: g,
          intPlayed: 0, intWin: 0, intDraw: 0, intLoss: 0,
          intGoalsFor: 0, intGoalsAgainst: 0, _form: [],
        });
      }
      const s = m.get(name);
      if (!s.strBadge && badge) s.strBadge = badge;
      return s;
    };

    // Process in kickoff order so the form string reads oldest → newest.
    const ordered = events
      .filter((e) => e.strGroup && e.strHomeTeam && e.strAwayTeam)
      .sort((a, b) => this._kickoff(a) - this._kickoff(b));

    for (const e of ordered) {
      const state = this._state(e);
      const counts = state === "final" || (countLive && state === "live");
      if (!counts) continue;
      const hs = Number(e.intHomeScore);
      const as = Number(e.intAwayScore);
      if (Number.isNaN(hs) || Number.isNaN(as)) continue;

      const g = `Group ${String(e.strGroup).replace(/^group\s*/i, "").trim()}`;
      if (!matches.has(g)) matches.set(g, []);
      matches.get(g).push({ h: e.strHomeTeam, a: e.strAwayTeam, hs, as });
      const home = teamStat(g, e.strHomeTeam, e.strHomeTeamBadge);
      const away = teamStat(g, e.strAwayTeam, e.strAwayTeamBadge);

      home.intPlayed++; away.intPlayed++;
      home.intGoalsFor += hs; home.intGoalsAgainst += as;
      away.intGoalsFor += as; away.intGoalsAgainst += hs;

      if (hs > as) {
        home.intWin++; away.intLoss++;
        home._form.push({ r: "W", vs: e.strAwayTeam });
        away._form.push({ r: "L", vs: e.strHomeTeam });
      } else if (hs < as) {
        away.intWin++; home.intLoss++;
        away._form.push({ r: "W", vs: e.strHomeTeam });
        home._form.push({ r: "L", vs: e.strAwayTeam });
      } else {
        home.intDraw++; away.intDraw++;
        home._form.push({ r: "D", vs: e.strAwayTeam });
        away._form.push({ r: "D", vs: e.strHomeTeam });
      }
    }

    // Finalize: points, GD, rank, form string; sort groups and rows.
    const out = [];
    for (const [g, m] of groups) {
      const rows = [...m.values()];
      for (const s of rows) {
        s.intPoints = s.intWin * 3 + s.intDraw;
        s.intGoalDifference = s.intGoalsFor - s.intGoalsAgainst;
        s._formDetail = s._form.slice(-5); // last 5, oldest → newest
        s.strForm = s._formDetail.map((f) => f.r).join("");
      }
      const ranked = rankGroupTable(rows, matches.get(g) || [], (s) => s.strTeam, {
        pts: (s) => s.intPoints, gd: (s) => s.intGoalDifference, gf: (s) => s.intGoalsFor,
      });
      ranked.forEach((s, i) => (s.intRank = i + 1));
      out.push({ group: g, rows: ranked });
    }

    let result = out.sort((a, b) =>
      String(a.group).localeCompare(String(b.group), undefined, { numeric: true })
    );

    if (this._config.group) {
      const want = String(this._config.group).toLowerCase().replace(/^group\s*/, "").trim();
      result = result.filter((g) => g.group.toLowerCase().replace(/^group\s*/, "").trim() === want);
    }
    return result;
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

  _state(e) {
    const s = (e.strStatus || "").trim();
    const hasScore = e.intHomeScore !== null && e.intHomeScore !== "" && e.intHomeScore !== undefined;
    if (FINISHED.has(s)) return "final";
    if (NOT_STARTED.has(s) || (!s && !hasScore)) return "upcoming";
    if (hasScore) return "live";
    return "upcoming";
  }

  _render() {
    const compact = this._config.compact;
    const showForm = this._config.show_form;
    const css = `
      :host { --wc-accent: var(--primary-color, #03a9f4); }
      ha-card { padding: 0; overflow: hidden; }
      .wrap { padding: 8px 12px 14px; }
      .header { display:flex; align-items:center; gap:8px; padding:14px 16px 6px;
        font-size:1.35em; font-weight:600; }
      .header .logo { --mdc-icon-size: 24px; color: var(--wc-accent); }
      .scroller { overflow-y: auto; }
      .group { margin-top: 16px; }
      .group:first-child { margin-top: 6px; }
      .group-label { font-size:.8em; font-weight:700; letter-spacing:.04em; text-transform:uppercase;
        color: var(--secondary-text-color); padding: 8px 4px 6px; position:sticky; top:0; z-index:2;
        background: var(--card-background-color, var(--ha-card-background, #1c1c1c)); }
      table { width:100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
      th, td { padding: 6px 4px; text-align: center; font-size:.9em; }
      th { font-size:.66em; font-weight:700; letter-spacing:.05em; text-transform:uppercase;
        color: var(--secondary-text-color); border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.25)); }
      th[title] { cursor: help; text-decoration: underline dotted; text-underline-offset: 2px; }
      td { border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.12)); }
      tr:last-child td { border-bottom: none; }
      th.pos, td.pos { width: 1.8em; color: var(--secondary-text-color); font-weight:700; }
      th.team, td.team { text-align: left; }
      .team-cell { display:flex; align-items:center; gap:8px; min-width:0; }
      .team-cell img { width:22px; height:22px; object-fit:contain; flex:0 0 22px;
        background:#fff; border-radius:3px; }
      .team-cell .name { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .team-cell .code { letter-spacing:.5px; }
      .team-cell .full { display:none; }
      /* On hover, swap the 3-letter code for the full country name. It sits on
         top of the row (raised z-index + card background) so it stays legible
         over the numeric columns to its right. */
      .team-cell:hover { position:relative; z-index:3; cursor:default; }
      .team-cell:hover .code { display:none; }
      .team-cell:hover .full { display:inline; }
      .team-cell:hover .name { overflow:visible; background: var(--card-background-color, var(--ha-card-background, #1c1c1c));
        padding:0 4px; border-radius:4px; }
      td.pts { font-weight:800; }
      td.gd-pos { color: var(--success-color, #43a047); }
      td.gd-neg { color: var(--error-color, #e53935); }
      /* Qualifying positions get an accent bar down the left edge. */
      tr.qualify td.pos { box-shadow: inset 3px 0 0 var(--wc-accent); }
      .form { display:flex; gap:2px; justify-content:center; }
      .form span { width:14px; height:14px; line-height:14px; border-radius:3px;
        font-size:9px; font-weight:800; color:#fff; cursor:help; }
      .form .W { background: var(--success-color, #43a047); }
      .form .D { background: var(--secondary-text-color, #888); }
      .form .L { background: var(--error-color, #e53935); }
      .count { font-size:.6em; font-weight:600; color: var(--secondary-text-color); margin-left:auto; }
      .meta { font-size:.7em; color: var(--secondary-text-color); }
      .msg { padding: 24px 16px; text-align:center; color: var(--secondary-text-color); }
      .updated { text-align:center; font-size:.68em; color: var(--secondary-text-color); padding:10px 0 2px; }
      .updated.rate-limited { color: var(--warning-color, #e5a50a); }
    `;

    let body;
    if (this._loading) {
      body = `<div class="msg">Loading standings…</div>`;
    } else if (this._error) {
      body = `<div class="msg">⚠️ Could not load standings<br><span class="meta">${this._esc(this._error)}</span></div>`;
    } else if (!this._groupsData || this._groupsData.length === 0) {
      body = `<div class="msg">No results yet.${this._config.group ? " (filter: " + this._esc(this._config.group) + ")" : ""}</div>`;
    } else {
      body = this._groupsData.map((g) => this._renderGroup(g, compact, showForm)).join("");
    }

    const teamCount = this._groupsData ? this._groupsData.reduce((n, g) => n + g.rows.length, 0) : 0;
    const count = teamCount ? `<span class="count">${teamCount} teams</span>` : "";
    const titlePart = this._config.title
      ? `<ha-icon class="logo" icon="mdi:trophy"></ha-icon><span>${this._esc(this._config.title)}</span>`
      : "";
    const header = (this._config.title || teamCount)
      ? `<div class="header">${titlePart}${count}</div>`
      : "";

    const updated = !this._loading && !this._error
      ? `<div class="updated${this._rateLimited ? " rate-limited" : ""}">${this._updatedText()}</div>`
      : "";

    const mh = this._config.max_height;
    const scrollStyle = mh ? ` style="max-height:${this._esc(mh)}"` : "";

    const prev = this.shadowRoot.querySelector(".scroller");
    const prevScroll = prev ? prev.scrollTop : null;

    this.shadowRoot.innerHTML =
      `<style>${css}</style><ha-card>${header}<div class="wrap"><div class="scroller"${scrollStyle}>${body}</div>${updated}</div></ha-card>`;

    const scroller = this.shadowRoot.querySelector(".scroller");
    if (prevScroll != null && scroller) scroller.scrollTop = prevScroll;
  }

  // [label, tooltip, extra <th> classes]
  static get COLS() {
    return {
      pos: ["#", "Position in group", "pos"],
      team: ["Team", "Team", "team"],
      P: ["P", "Played — matches played", ""],
      W: ["W", "Won", ""],
      D: ["D", "Drawn", ""],
      L: ["L", "Lost", ""],
      GF: ["GF", "Goals For — goals scored", ""],
      GA: ["GA", "Goals Against — goals conceded", ""],
      GD: ["GD", "Goal Difference (GF − GA)", ""],
      Pts: ["Pts", "Points — 3 for a win, 1 for a draw", "pts"],
      Form: ["Form", "Recent results, oldest → newest (W = won, D = drawn, L = lost)", ""],
    };
  }

  _renderGroup({ group, rows }, compact, showForm) {
    const order = compact
      ? ["pos", "team", "P", "GD", "Pts"]
      : ["pos", "team", "P", "W", "D", "L", "GF", "GA", "GD", "Pts"];
    if (showForm) order.push("Form");

    const cols = order
      .map((key) => {
        const [label, tip, cls] = WorldCupStandingsCard.COLS[key];
        return `<th${cls ? ` class="${cls}"` : ""} title="${this._esc(tip)}">${this._esc(label)}</th>`;
      })
      .join("");

    const trs = rows.map((e) => this._renderRow(e, compact, showForm)).join("");
    return `<div class="group">
      <div class="group-label">${this._esc(group)}</div>
      <table><thead><tr>${cols}</tr></thead><tbody>${trs}</tbody></table>
    </div>`;
  }

  _renderRow(e, compact, showForm) {
    const rank = Number(e.intRank) || 0;
    const qualify = this._config.highlight_top > 0 && rank >= 1 && rank <= this._config.highlight_top;
    const gd = Number(e.intGoalDifference) || 0;
    const gdClass = gd > 0 ? "gd-pos" : gd < 0 ? "gd-neg" : "";
    const gdText = gd > 0 ? `+${gd}` : String(gd);

    const badge = e.strBadge
      ? `<img src="${this._esc(e.strBadge)}" loading="lazy" onerror="this.style.visibility='hidden'">`
      : `<span style="width:22px;flex:0 0 22px"></span>`;
    const teamCell =
      `<div class="team-cell">${badge}<span class="name"><span class="code">${this._esc(this._code(e.strTeam))}</span><span class="full">${this._esc(e.strTeam)}</span></span></div>`;

    const form = showForm ? `<td>${this._renderForm(e._formDetail)}</td>` : "";

    if (compact) {
      return `<tr class="${qualify ? "qualify" : ""}">
        <td class="pos">${rank || ""}</td>
        <td class="team">${teamCell}</td>
        <td>${this._n(e.intPlayed)}</td>
        <td class="${gdClass}">${gdText}</td>
        <td class="pts">${this._n(e.intPoints)}</td>
        ${form}
      </tr>`;
    }
    return `<tr class="${qualify ? "qualify" : ""}">
      <td class="pos">${rank || ""}</td>
      <td class="team">${teamCell}</td>
      <td>${this._n(e.intPlayed)}</td>
      <td>${this._n(e.intWin)}</td>
      <td>${this._n(e.intDraw)}</td>
      <td>${this._n(e.intLoss)}</td>
      <td>${this._n(e.intGoalsFor)}</td>
      <td>${this._n(e.intGoalsAgainst)}</td>
      <td class="${gdClass}">${gdText}</td>
      <td class="pts">${this._n(e.intPoints)}</td>
      ${form}
    </tr>`;
  }

  _renderForm(detail) {
    const labels = { W: "Won", D: "Drew", L: "Lost" };
    const list = Array.isArray(detail)
      ? detail
      : String(detail || "")
          .toUpperCase()
          .split("")
          .filter((c) => c === "W" || c === "D" || c === "L")
          .map((c) => ({ r: c, vs: "" }));
    if (!list.length) return "";
    const pills = list
      .filter((f) => f && (f.r === "W" || f.r === "D" || f.r === "L"))
      .map((f) => {
        const tip = f.vs ? `${labels[f.r]} vs. ${f.vs}` : labels[f.r];
        return `<span class="${f.r}" title="${this._esc(tip)}">${f.r}</span>`;
      })
      .join("");
    return `<div class="form">${pills}</div>`;
  }

  _n(v) {
    return v === null || v === undefined || v === "" ? "0" : this._esc(v);
  }

  _code(team) {
    if (!team) return "";
    if (TEAM_CODES[team]) return TEAM_CODES[team];
    const cleaned = team.replace(/[^A-Za-z]/g, "");
    return (cleaned.slice(0, 3) || team.slice(0, 3)).toUpperCase();
  }

  _esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
}

customElements.define("worldcup-standings-card", WorldCupStandingsCard);

// Register with the card picker so it shows up in the "Add Card" dialog.
window.customCards = window.customCards || [];
window.customCards.push({
  type: "worldcup-standings-card",
  name: "World Cup Standings Card",
  description: "FIFA World Cup 2026 group standings, computed live from results.",
  preview: false,
});

console.info("%c WORLDCUP-STANDINGS-CARD %c loaded ", "background:#03a9f4;color:#fff;border-radius:3px 0 0 3px;padding:2px 4px", "background:#222;color:#fff;border-radius:0 3px 3px 0;padding:2px 4px");
})();
