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
    this._lastFetch = null;
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
      const j = r.ok ? await r.json() : { events: [] };
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
    try {
      const results = await this._pool(rounds, 5, (r) => this._fetchRound(r));
      this._lastFetch = new Date(); // stamp every poll, even if nothing changed
      // Flatten + dedupe by event id.
      const seen = new Set();
      let events = [];
      for (const list of results) {
        for (const e of list || []) {
          const id = e.idEvent || `${e.dateEvent}-${e.strEvent}`;
          if (seen.has(id)) continue;
          seen.add(id);
          events.push(e);
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
    if (el && this._lastFetch) {
      el.textContent = `Updated ${this._fmtUpdated(this._lastFetch)} · TheSportsDB`;
    }
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
      .liveline .kt { font-weight:700; color: var(--secondary-text-color); }
      .liveline .min { font-weight:800; font-variant-numeric: tabular-nums; color: var(--error-color, #e53935); }
      .venue .kt { font-weight:700; }
      .venue { grid-column: 1 / -1; font-size:.72em; color: var(--secondary-text-color);
        text-align:center; margin-top:2px; }
      .venue .grp { display:inline-block; padding:0 6px; border-radius:8px; font-weight:700;
        letter-spacing:.02em; background: var(--secondary-background-color, rgba(127,127,127,.16));
        color: var(--wc-accent); }
      .venue .sep { opacity:.5; margin:0 5px; }
      .scroller { overflow-y: auto; scroll-behavior: smooth; }
      .count { font-size:.6em; font-weight:600; color: var(--secondary-text-color); margin-left:auto; }
      .meta { font-size:.7em; color: var(--secondary-text-color); }
      .msg { padding: 24px 16px; text-align:center; color: var(--secondary-text-color); }
      .updated { text-align:center; font-size:.68em; color: var(--secondary-text-color); padding:10px 0 2px; }
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
      ? `<div class="updated">Updated ${this._fmtUpdated(this._lastFetch || new Date())} · TheSportsDB</div>`
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
      // Pulsing LIVE badge flanked by the kickoff time and the current minute.
      // Prefer strProgress (the minute, e.g. "63"); when the feed omits it,
      // fall back to the status code, which carries the phase (1H, HT, 2H, ET…).
      const startT = this._fmtTime(new Date(this._kickoff(e)));
      const prog = (e.strProgress || "").trim();
      const status = (e.strStatus || "").trim();
      const minLabel = prog
        ? (/^\d+$/.test(prog) ? `${prog}'` : this._esc(prog))
        : (status && status.toUpperCase() !== "LIVE" ? this._esc(status) : "");
      mid =
        `<div class="score">${hs}–${as}</div>` +
        `<div class="liveline"><span class="kt">${startT}</span>` +
        `<span class="badge live">LIVE</span>` +
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
    // For finished matches, add the kickoff time and the total game time
    // (90' regulation, 120' after extra time, +pens if decided on penalties).
    const timeParts = state === "final"
      ? [`<span class="kt">${this._fmtTime(new Date(this._kickoff(e)))}</span>`, `<span>${this._totalTime(e)}</span>`]
      : [];
    const metaParts = [groupChip, ...timeParts, venueText].filter(Boolean);
    const meta = metaParts.length
      ? `<div class="venue">${metaParts.join('<span class="sep">·</span>')}</div>`
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
    // Fallback for any unmapped team (e.g. a not-yet-named knockout slot):
    // first three letters, uppercased and stripped of non-letters.
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

  // Match-length category for a finished match. TheSportsDB exposes no elapsed,
  // end-time, or stoppage field, so an exact total (e.g. 90+5) is impossible —
  // we can only read the category from the status. The trailing "+" denotes the
  // unknown stoppage added on top of regulation (90'+) or extra time (120'+).
  _totalTime(e) {
    const s = (e.strStatus || "").trim().toUpperCase();
    if (s === "PEN" || s === "FT_PEN" || s === "AP") return "120'+ pens";
    if (s === "AET") return "120'+";
    return "90'+";
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
