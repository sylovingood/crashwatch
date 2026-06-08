import { useState, useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────────
// CONFIGURATION — paste your Finnhub API key here after signing up
// at https://finnhub.io (free, takes 30 seconds)
// ─────────────────────────────────────────────────────────────────
const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY;

// EmailJS config — sign up free at https://emailjs.com
const EMAILJS_SERVICE_ID  = "YOUR_SERVICE_ID";
const EMAILJS_TEMPLATE_ID = "YOUR_TEMPLATE_ID";
const EMAILJS_PUBLIC_KEY  = "YOUR_PUBLIC_KEY";

// ── Palette ───────────────────────────────────────────────────────
const C = {
  bg:      "#0A0E1A",
  surface: "#111827",
  border:  "#1E293B",
  accent:  "#F59E0B",
  red:     "#EF4444",
  green:   "#10B981",
  purple:  "#8B5CF6",
  muted:   "#64748B",
  text:    "#F1F5F9",
  sub:     "#94A3B8",
};

// ── Symbols → Finnhub tickers ─────────────────────────────────────
// S&P 500 → SPY ETF, Nasdaq → QQQ, Dow → DIA, VIX → direct index
const SYMBOLS = [
  { key: "sp500", ticker: "SPY", name: "SPY ETF" }
  { key: "nasdaq", ticker: "QQQ", name: "QQQ ETF" }
  { key: "dow", ticker: "DIA", name: "DIA ETF" }
  { key: "vix",    ticker: "VIX",  name: "VIX",       label: "VIX",  multiplier: 1 },
];

// ── Historical crashes ────────────────────────────────────────────
const CRASHES = [
  {
    name: "Black Monday", year: 1987, color: "#8B5CF6",
    curve: Array.from({ length: 60 }, (_, i) => {
      if (i < 2)  return 100 - i * 17;
      if (i < 10) return 66 - (i - 2) * 1.5;
      if (i < 40) return 54 + (i - 10) * 1.5;
      return Math.min(100, 99 + (i - 40) * 0.05);
    }),
    totalDrop: 34, recoveryDays: 504, cause: "Program trading cascade",
  },
  {
    name: "Dot-com", year: 2000, color: "#EC4899",
    curve: Array.from({ length: 60 }, (_, i) => {
      if (i < 5)  return 100 - i * 3;
      if (i < 50) return 85 - (i - 5) * 0.8;
      return Math.max(49, 85 - 45 * 0.8 + (i - 50) * 0.3);
    }),
    totalDrop: 49, recoveryDays: 2500, cause: "Tech bubble burst",
  },
  {
    name: "GFC 2008", year: 2008, color: "#EF4444",
    curve: Array.from({ length: 60 }, (_, i) => {
      if (i < 3)  return 100 - i * 3;
      if (i < 30) return 91 - (i - 3) * 1.6;
      if (i < 45) return 48 - (i - 30) * 0.1;
      return Math.min(100, 47 + (i - 45) * 1.1);
    }),
    totalDrop: 57, recoveryDays: 1500, cause: "Subprime mortgage crisis",
  },
  {
    name: "COVID 2020", year: 2020, color: "#F59E0B",
    curve: Array.from({ length: 60 }, (_, i) => {
      if (i < 23) return 100 - i * 1.55;
      return Math.min(100, 64.4 + (i - 23) * 1.5);
    }),
    totalDrop: 34, recoveryDays: 148, cause: "COVID-19 pandemic",
  },
];

const DEFAULT_TIERS = [
  { drop: 10, amount: 500,  label: "Dip",        color: C.accent },
  { drop: 20, amount: 500,  label: "Correction", color: "#F97316" },
  { drop: 30, amount: 1000, label: "Crash",      color: C.red },
  { drop: 50, amount: 2000, label: "Crisis",     color: "#9F1239" },
];

// ── Finnhub fetch helper ──────────────────────────────────────────
async function fetchQuote(ticker) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub error: ${res.status}`);
  return res.json();
  // Returns: { c: current, h: high, l: low, o: open, pc: prev close, dp: % change }
}

async function fetchNews() {
  const today = new Date().toISOString().split("T")[0];
  const week  = new Date(Date.now() - 7 * 864e5).toISOString().split("T")[0];
  const url   = `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`;
  const res   = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data || []).slice(0, 8).map(n => ({
    time:      new Date(n.datetime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    source:    n.source,
    text:      n.headline,
    sentiment: n.sentiment > 0.1 ? "bullish" : n.sentiment < -0.1 ? "bearish" : "neutral",
    url:       n.url,
  }));
}

// ── 52-week high tracker (localStorage for "peak" tracking) ───────
function getStoredPeak(key, currentPrice) {
  try {
    const stored = JSON.parse(localStorage.getItem("cwPeaks") || "{}");
    const peak = stored[key] || currentPrice;
    const newPeak = Math.max(peak, currentPrice);
    localStorage.setItem("cwPeaks", JSON.stringify({ ...stored, [key]: newPeak }));
    return newPeak;
  } catch { return currentPrice; }
}

function resetPeaks() {
  try { localStorage.removeItem("cwPeaks"); } catch {}
}

// ── Sparkline ─────────────────────────────────────────────────────
function Sparkline({ data, color, width = 80, height = 28 }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`
  ).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ── Crash chart ───────────────────────────────────────────────────
function CrashChart({ currentDrop, currentDay }) {
  const W = 560, H = 200;
  const xS = d => (d / 60) * W;
  const yS = v => H - ((v - 40) / 65) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {[100, 80, 60].map(v => (
        <g key={v}>
          <line x1={0} y1={yS(v)} x2={W} y2={yS(v)} stroke={C.border} strokeWidth="1" strokeDasharray="4,4" />
          <text x={4} y={yS(v) - 3} fontSize="9" fill={C.muted}>{v}%</text>
        </g>
      ))}
      {CRASHES.map(c => {
        const pts = c.curve.map((v, i) => `${xS(i)},${yS(v)}`).join(" ");
        return (
          <g key={c.name}>
            <polyline points={pts} fill="none" stroke={c.color} strokeWidth="1.5" strokeOpacity="0.75" strokeLinejoin="round" />
            <text x={xS(59) + 4} y={yS(c.curve[59])} fontSize="9" fill={c.color}>{c.name}</text>
          </g>
        );
      })}
      {currentDay !== null && (
        <g>
          <line x1={xS(currentDay)} y1={0} x2={xS(currentDay)} y2={H} stroke={C.accent} strokeWidth="1.5" strokeDasharray="4,3" />
          <circle cx={xS(currentDay)} cy={yS(100 + currentDrop)} r="4" fill={C.accent} />
          <text x={xS(currentDay) + 6} y={yS(100 + currentDrop) - 5} fontSize="9" fill={C.accent} fontWeight="600">NOW</text>
        </g>
      )}
      {DEFAULT_TIERS.map(t => (
        <line key={t.drop} x1={0} y1={yS(100 - t.drop)} x2={W} y2={yS(100 - t.drop)}
          stroke={t.color} strokeWidth="0.75" strokeOpacity="0.5" strokeDasharray="3,3" />
      ))}
    </svg>
  );
}

// ── Email modal ───────────────────────────────────────────────────
function EmailModal({ onClose, tiers, sp500Drop }) {
  const [email, setEmail]   = useState("");
  const [sent, setSent]     = useState(false);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState("");

  const send = async () => {
    if (!email.includes("@")) return;
    if (EMAILJS_PUBLIC_KEY === "YOUR_PUBLIC_KEY") {
      setErr("EmailJS not configured yet — see setup instructions below.");
      return;
    }
    setBusy(true);
    try {
      const { default: emailjs } = await import("https://cdn.jsdelivr.net/npm/@emailjs/browser@3/+esm");
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        to_email:   email,
        subject:    "CrashWatch — Test Alert",
        sp500_drop: sp500Drop?.toFixed(2) ?? "N/A",
        tiers:      tiers.map(t => `${t.label} (−${t.drop}%): $${t.amount}`).join("\n"),
        message:    "Your CrashWatch alerts are active. You'll receive emails when market thresholds are hit.",
      }, EMAILJS_PUBLIC_KEY);
      setSent(true);
    } catch (e) {
      setErr("Send failed: " + e.message);
    }
    setBusy(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:32, width:480, maxWidth:"90vw" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
          <span style={{ fontSize:18, fontWeight:600, fontFamily:"'DM Serif Display',serif", color:C.text }}>Email Alerts Setup</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:20 }}>✕</button>
        </div>

        {sent ? (
          <div style={{ textAlign:"center", padding:"20px 0" }}>
            <div style={{ fontSize:48, marginBottom:16 }}>✅</div>
            <p style={{ color:C.text, fontSize:16, marginBottom:8 }}>Test email sent to {email}</p>
            <p style={{ color:C.sub, fontSize:13 }}>Alerts will fire when your thresholds are hit.</p>
          </div>
        ) : (
          <>
            <p style={{ color:C.sub, fontSize:13, marginBottom:20, lineHeight:1.6 }}>
              Daily market summary every morning + instant alerts when the S&P 500 hits your thresholds.
            </p>
            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:12, color:C.muted, display:"block", marginBottom:6 }}>YOUR EMAIL</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com"
                style={{ width:"100%", padding:"10px 14px", background:C.bg, border:`1px solid ${C.border}`,
                  borderRadius:8, color:C.text, fontSize:14, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:20 }}>
              <label style={{ fontSize:12, color:C.muted, display:"block", marginBottom:10 }}>ALERT THRESHOLDS</label>
              {tiers.map((t, i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ width:8, height:8, borderRadius:"50%", background:t.color, flexShrink:0 }} />
                  <span style={{ color:C.sub, fontSize:13, flex:1 }}>{t.label} (−{t.drop}%)</span>
                  <span style={{ color:t.color, fontSize:13, fontWeight:600 }}>Deploy ${t.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>

            {/* Setup instructions */}
            <div style={{ marginBottom:16, padding:14, background:C.bg, borderRadius:8, border:`1px solid ${C.border}`, fontSize:12, color:C.sub, lineHeight:1.7 }}>
              <strong style={{ color:C.accent }}>⚙️ One-time EmailJS setup (free, 5 min):</strong><br/>
              1. Sign up at <a href="https://emailjs.com" target="_blank" style={{ color:C.accent }}>emailjs.com</a><br/>
              2. Add an Email Service (Gmail works great)<br/>
              3. Create a Template — use variables: <code style={{ color:C.text }}>{"{{to_email}} {{subject}} {{message}} {{tiers}} {{sp500_drop}}"}</code><br/>
              4. Copy your Service ID, Template ID, and Public Key into the top of the JSX file
            </div>

            {err && <p style={{ color:C.red, fontSize:12, marginBottom:12 }}>{err}</p>}

            <button onClick={send} disabled={busy || !email.includes("@")} style={{
              width:"100%", padding:"12px", borderRadius:8,
              background: email.includes("@") ? C.accent : C.border,
              color: email.includes("@") ? "#000" : C.muted,
              border:"none", fontSize:14, fontWeight:600,
              cursor: email.includes("@") ? "pointer" : "default",
            }}>
              {busy ? "Sending…" : "Send test alert & save"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Loading / error states ────────────────────────────────────────
function StatusBadge({ apiReady }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
      <div style={{ width:7, height:7, borderRadius:"50%", background: apiReady ? C.green : C.accent }} />
      <span style={{ fontSize:11, color:C.muted, fontFamily:"'DM Mono',monospace" }}>
        {apiReady ? "LIVE" : "DEMO — add API key"}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,        setTab]        = useState("dashboard");
  const [market,     setMarket]     = useState(null);
  const [news,       setNews]       = useState([]);
  const [tiers,      setTiers]      = useState(DEFAULT_TIERS);
  const [showEmail,  setShowEmail]  = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [apiReady,   setApiReady]   = useState(false);
  const [error,      setError]      = useState("");
  const alertedTiers = useRef(new Set());

  // ── Fetch live data ─────────────────────────────────────────────
  const fetchMarket = async () => {
    const isConfigured = FINNHUB_KEY !== "YOUR_FINNHUB_KEY_HERE";
    setApiReady(isConfigured);

    if (!isConfigured) {
      // Demo mode — realistic simulated data
      const demo = {
        sp500:  { value: 5432, prev: 5487, name: "S&P 500",   label: "SPX",  change: -55,  changePct: -1.00, fromPeak: -8.2,  history: Array.from({length:20},(_,i)=>5500-i*3.5+(Math.random()-0.5)*10) },
        nasdaq: { value: 17210, prev: 17380, name: "Nasdaq",  label: "COMP", change: -170, changePct: -0.98, fromPeak: -11.4, history: Array.from({length:20},(_,i)=>17500-i*14+(Math.random()-0.5)*40) },
        dow:    { value: 42180, prev: 42540, name: "Dow Jones",label: "DJIA", change: -360, changePct: -0.85, fromPeak: -7.1,  history: Array.from({length:20},(_,i)=>42700-i*25+(Math.random()-0.5)*80) },
        vix:    { value: 18.4,  prev: 16.2,  name: "VIX",     label: "VIX",  change: 2.2,  changePct: 13.6,  fromPeak: null,  history: Array.from({length:20},(_,i)=>16+i*0.12+(Math.random()-0.5)*0.5) },
      };
      setMarket(demo);
      setLoading(false);
      setLastUpdate(new Date());
      return;
    }

    try {
      // Fetch all symbols in parallel
      const results = await Promise.allSettled(
        SYMBOLS.map(s => fetchQuote(s.ticker))
      );

      const updated = {};
      SYMBOLS.forEach((s, i) => {
        const r = results[i];
        if (r.status === "fulfilled") {
          const d = r.value;
          const current = d.c;
          const prev    = d.pc;
          const peak    = getStoredPeak(s.key, current);
          updated[s.key] = {
            value:     current,
            prev,
            name:      s.name,
            label:     s.label,
            change:    d.c - d.pc,
            changePct: d.dp,
            fromPeak:  s.key !== "vix" ? ((current - peak) / peak) * 100 : null,
            high:      d.h,
            low:       d.l,
            open:      d.o,
            history:   [], // could fetch candles with another call
          };
        }
      });

      if (Object.keys(updated).length > 0) {
        setMarket(updated);
        setError("");
      }
      setLastUpdate(new Date());
    } catch (e) {
      setError("API error: " + e.message);
    }
    setLoading(false);
  };

  const fetchMarketNews = async () => {
    const isConfigured = FINNHUB_KEY !== "YOUR_FINNHUB_KEY_HERE";
    if (!isConfigured) {
      // Demo news
      setNews([
        { time:"2m",  source:"Reuters",    sentiment:"bearish", text:"Fed signals rates unchanged through Q3 amid inflation concerns", url:"#" },
        { time:"14m", source:"Bloomberg",  sentiment:"bearish", text:"Hedge fund net short positions hit 18-month high on S&P futures", url:"#" },
        { time:"31m", source:"CNBC",       sentiment:"neutral", text:"Q2 earnings season begins — analysts expect 4.2% YoY growth", url:"#" },
        { time:"1h",  source:"WSJ",        sentiment:"bearish", text:"Goldman cuts S&P 500 year-end target citing valuation stretch", url:"#" },
        { time:"2h",  source:"FT",         sentiment:"bullish", text:"Labor market remains resilient — jobless claims fall for 3rd week", url:"#" },
        { time:"3h",  source:"Axios",      sentiment:"bearish", text:"Volatility derivatives signal elevated crash risk into Q3", url:"#" },
        { time:"4h",  source:"MarketWatch",sentiment:"neutral", text:"Tech sector rotation continues as value stocks outperform", url:"#" },
      ]);
      return;
    }
    try {
      const data = await fetchNews();
      if (data.length > 0) setNews(data);
    } catch {}
  };

  // ── Check thresholds and trigger email alert ─────────────────────
  const checkThresholds = (marketData) => {
    if (!marketData?.sp500) return;
    const drop = Math.abs(marketData.sp500.fromPeak || 0);
    tiers.forEach(t => {
      if (drop >= t.drop && !alertedTiers.current.has(t.drop)) {
        alertedTiers.current.add(t.drop);
        // Send email alert if EmailJS is configured
        if (EMAILJS_PUBLIC_KEY !== "YOUR_PUBLIC_KEY") {
          import("https://cdn.jsdelivr.net/npm/@emailjs/browser@3/+esm").then(({ default: emailjs }) => {
            const savedEmail = localStorage.getItem("cwEmail");
            if (savedEmail) {
              emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
                to_email:   savedEmail,
                subject:    `🚨 CrashWatch Alert — Market down ${drop.toFixed(1)}% (${t.label})`,
                message:    `The S&P 500 has dropped ${drop.toFixed(1)}% from its recent peak, hitting your ${t.label} threshold. Your strategy says: deploy $${t.amount.toLocaleString()}.`,
                sp500_drop: drop.toFixed(2),
                tiers:      `${t.label} triggered — deploy $${t.amount}`,
              }, EMAILJS_PUBLIC_KEY);
            }
          });
        }
      }
    });
  };

  useEffect(() => {
    fetchMarket();
    fetchMarketNews();
    const interval = setInterval(() => {
      fetchMarket();
    }, 30000); // refresh every 30s
    const newsInterval = setInterval(() => {
      fetchMarketNews();
    }, 300000); // news every 5 min
    return () => { clearInterval(interval); clearInterval(newsInterval); };
  }, []);

  useEffect(() => {
    if (market) checkThresholds(market);
  }, [market]);

  const sp         = market?.sp500;
  const currentDrop = sp?.fromPeak ?? -8.2;
  const currentDay  = 12;
  const nextTier    = tiers.find(t => Math.abs(currentDrop) < t.drop);
  const activeTier  = [...tiers].reverse().find(t => Math.abs(currentDrop) >= t.drop);
  const matchedCrash = CRASHES.reduce((best, c) =>
    Math.abs(c.totalDrop - Math.abs(currentDrop)) < Math.abs(best.totalDrop - Math.abs(currentDrop)) ? c : best
  , CRASHES[0]);

  const updateTier = (i, field, val) => {
    const u = [...tiers];
    u[i] = { ...u[i], [field]: Number(val) };
    setTiers(u);
  };

  // ── Shared styles ───────────────────────────────────────────────
  const card = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:20 };
  const mono = { fontFamily:"'DM Mono',monospace" };

  if (loading) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", color:C.sub, fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:32, marginBottom:12 }}>📉</div>
        <div>Loading market data…</div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'DM Sans','Helvetica Neue',sans-serif", fontSize:14 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Serif+Display&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ borderBottom:`1px solid ${C.border}`, padding:"14px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, background:C.bg, zIndex:50 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:32, height:32, borderRadius:8, background:C.accent, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>📉</div>
          <div>
            <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:18 }}>CrashWatch</div>
            <StatusBadge apiReady={apiReady} />
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {lastUpdate && (
            <span style={{ fontSize:11, color:C.muted, ...mono }}>
              {lastUpdate.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}
            </span>
          )}
          <button onClick={() => { fetchMarket(); fetchMarketNews(); }} style={{ padding:"6px 12px", borderRadius:6, background:C.surface, border:`1px solid ${C.border}`, color:C.sub, cursor:"pointer", fontSize:12 }}>
            ↻ Refresh
          </button>
          <button onClick={() => setShowEmail(true)} style={{ padding:"8px 16px", borderRadius:8, background:C.accent, border:"none", color:"#000", fontWeight:600, cursor:"pointer", fontSize:13 }}>
            🔔 Alerts
          </button>
        </div>
      </div>

      {/* Demo mode banner */}
      {!apiReady && (
        <div style={{ padding:"10px 24px", background:"rgba(245,158,11,0.08)", borderBottom:`1px solid rgba(245,158,11,0.2)`, fontSize:12, color:C.accent, display:"flex", alignItems:"center", gap:8 }}>
          <span>⚡ Demo mode — data is simulated.</span>
          <span style={{ color:C.sub }}>Add your free Finnhub API key at the top of the JSX file to go live. Sign up at</span>
          <a href="https://finnhub.io" target="_blank" style={{ color:C.accent }}>finnhub.io</a>
        </div>
      )}

      {error && (
        <div style={{ padding:"10px 24px", background:"rgba(239,68,68,0.08)", borderBottom:`1px solid rgba(239,68,68,0.2)`, fontSize:12, color:C.red }}>
          {error} — showing last known data
        </div>
      )}

      {/* Nav */}
      <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, padding:"0 24px" }}>
        {[["dashboard","📊 Dashboard"],["crashes","📉 Crash History"],["strategy","⚡ Strategy"],["news","📰 News"]].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:"12px 18px", background:"none", border:"none", borderBottom: tab===t ? `2px solid ${C.accent}` : "2px solid transparent", color: tab===t ? C.accent : C.muted, cursor:"pointer", fontSize:13, fontWeight: tab===t ? 600 : 400, transition:"all 0.15s" }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding:24, maxWidth:960, margin:"0 auto" }}>

        {/* ── DASHBOARD ── */}
        {tab === "dashboard" && (
          <>
            {/* Alert banner */}
            {Math.abs(currentDrop) >= 7 && (
              <div style={{ padding:"12px 16px", borderRadius:10, marginBottom:20, background: Math.abs(currentDrop)>=10 ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)", border:`1px solid ${Math.abs(currentDrop)>=10 ? C.red : C.accent}`, display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:20 }}>{Math.abs(currentDrop)>=10 ? "🚨" : "⚠️"}</span>
                <div>
                  <div style={{ fontWeight:600, color: Math.abs(currentDrop)>=10 ? C.red : C.accent, fontSize:13 }}>
                    {Math.abs(currentDrop)>=10 ? `THRESHOLD HIT — Market down ${Math.abs(currentDrop).toFixed(1)}% from peak` : `Approaching threshold — Market down ${Math.abs(currentDrop).toFixed(1)}% from peak`}
                  </div>
                  {nextTier && <div style={{ color:C.sub, fontSize:12, marginTop:2 }}>Next action at −{nextTier.drop}%: deploy ${nextTier.amount.toLocaleString()}</div>}
                </div>
              </div>
            )}

            {/* Market cards */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:12, marginBottom:24 }}>
              {market && Object.values(market).map(m => (
                <div key={m.label} style={{ ...card, borderLeft:`3px solid ${m.changePct<0 ? C.red : C.green}`, padding:16 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                    <div>
                      <div style={{ fontSize:11, color:C.muted, ...mono }}>{m.label}</div>
                      <div style={{ fontSize:12, color:C.sub }}>{m.name}</div>
                    </div>
                    <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4, background: m.changePct<0 ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)", color: m.changePct<0 ? C.red : C.green, ...mono }}>
                      {m.changePct>0?"+":""}{m.changePct?.toFixed(2)}%
                    </span>
                  </div>
                  <div style={{ fontSize:22, fontWeight:600, ...mono }}>
                    {m.label==="VIX" ? m.value?.toFixed(2) : Math.round(m.value)?.toLocaleString()}
                  </div>
                  {m.fromPeak !== null && (
                    <div style={{ marginTop:6, fontSize:11, color:C.red, ...mono }}>{m.fromPeak?.toFixed(1)}% from peak</div>
                  )}
                  {m.label==="VIX" && (
                    <div style={{ marginTop:6, fontSize:11, color: m.value>30?C.red:m.value>20?C.accent:C.green }}>
                      {m.value>30?"Extreme fear":m.value>20?"Elevated fear":m.value>15?"Moderate":"Calm"}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Strategy bar */}
            <div style={{ ...card, marginBottom:24 }}>
              <div style={{ marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontFamily:"'DM Serif Display',serif", fontSize:16 }}>Strategy Deployment</span>
                <span style={{ fontSize:12, color:C.muted }}>S&P 500 {currentDrop.toFixed(1)}% from peak</span>
              </div>
              <div style={{ position:"relative", height:8, background:C.border, borderRadius:4, marginBottom:20 }}>
                <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${Math.min(100,Math.abs(currentDrop)/55*100)}%`, background:`linear-gradient(90deg,${C.accent},${C.red})`, borderRadius:4 }} />
                {tiers.map(t => (
                  <div key={t.drop} style={{ position:"absolute", left:`${(t.drop/55)*100}%`, top:-4, width:2, height:16, background:t.color, borderRadius:1 }} />
                ))}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10 }}>
                {tiers.map((t,i) => {
                  const hit = Math.abs(currentDrop) >= t.drop;
                  return (
                    <div key={i} style={{ padding:"10px 14px", borderRadius:8, background: hit?`${t.color}15`:C.bg, border:`1px solid ${hit?t.color:C.border}`, opacity:hit?1:0.55 }}>
                      <div style={{ fontSize:11, color:t.color, fontWeight:600, marginBottom:4 }}>{hit?"✓ ":""}{t.label} (−{t.drop}%)</div>
                      <div style={{ fontSize:16, fontWeight:600, ...mono }}>${t.amount.toLocaleString()}</div>
                      <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{hit?"Threshold reached":"Pending"}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Crash match */}
            <div style={card}>
              <div style={{ marginBottom:12, fontFamily:"'DM Serif Display',serif", fontSize:16 }}>Closest Historical Match</div>
              <div style={{ display:"flex", alignItems:"center", gap:16, padding:16, background:C.bg, borderRadius:10 }}>
                <div style={{ width:4, alignSelf:"stretch", borderRadius:2, background:matchedCrash.color, flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:16, fontWeight:600, color:matchedCrash.color, marginBottom:4 }}>{matchedCrash.name} ({matchedCrash.year})</div>
                  <div style={{ color:C.sub, fontSize:13, marginBottom:10 }}>{matchedCrash.cause}</div>
                  <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
                    {[["Total drop",`−${matchedCrash.totalDrop}%`,C.red],["Recovery",matchedCrash.recoveryDays<365?`${matchedCrash.recoveryDays}d`:`${(matchedCrash.recoveryDays/365).toFixed(1)}yr`,C.green],["If same bottom",`~−${matchedCrash.totalDrop}%`,C.accent]].map(([l,v,c])=>(
                      <div key={l}>
                        <div style={{ fontSize:11, color:C.muted }}>{l}</div>
                        <div style={{ color:c, ...mono, fontWeight:600 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── CRASH HISTORY ── */}
        {tab === "crashes" && (
          <>
            <div style={{ marginBottom:20 }}>
              <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:20, marginBottom:6 }}>Where are we in this drawdown?</div>
              <div style={{ color:C.sub, fontSize:13 }}>Current S&P 500 is {currentDrop.toFixed(1)}% below its recent peak (day ~{currentDay}). Dotted lines = your buy thresholds.</div>
            </div>
            <div style={{ ...card, marginBottom:20 }}>
              <CrashChart currentDrop={currentDrop} currentDay={currentDay} />
              <div style={{ display:"flex", flexWrap:"wrap", gap:16, marginTop:16 }}>
                {CRASHES.map(c=>(
                  <div key={c.name} style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{ width:20, height:2, background:c.color, borderRadius:1 }} />
                    <span style={{ fontSize:12, color:C.sub }}>{c.name}</span>
                  </div>
                ))}
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:20, height:2, background:C.accent, borderRadius:1 }} />
                  <span style={{ fontSize:12, color:C.accent }}>Current</span>
                </div>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))", gap:12 }}>
              {CRASHES.map(c=>(
                <div key={c.name} style={{ ...card, borderTop:`3px solid ${c.color}` }}>
                  <div style={{ fontSize:15, fontWeight:600, marginBottom:4 }}>{c.name} ({c.year})</div>
                  <div style={{ fontSize:12, color:C.muted, marginBottom:12 }}>{c.cause}</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
                    <div><div style={{ fontSize:11, color:C.muted }}>Peak drop</div><div style={{ color:C.red, ...mono, fontWeight:600, fontSize:16 }}>−{c.totalDrop}%</div></div>
                    <div><div style={{ fontSize:11, color:C.muted }}>Recovery</div><div style={{ color:C.green, ...mono, fontWeight:600, fontSize:16 }}>{c.recoveryDays<365?`${c.recoveryDays}d`:`${(c.recoveryDays/365).toFixed(1)}yr`}</div></div>
                  </div>
                  <div style={{ padding:"6px 10px", borderRadius:6, background:C.bg, fontSize:12, color:C.sub }}>
                    If this repeats: bottom at <span style={{ color:c.color }}>−{c.totalDrop}%</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── STRATEGY ── */}
        {tab === "strategy" && (
          <>
            <div style={{ marginBottom:20 }}>
              <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:20, marginBottom:6 }}>Your Buy Strategy</div>
              <div style={{ color:C.sub, fontSize:13 }}>Edit thresholds and deploy amounts. Email alerts fire the moment each level is hit.</div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:24 }}>
              {tiers.map((t,i)=>{
                const hit = Math.abs(currentDrop)>=t.drop;
                return (
                  <div key={i} style={{ ...card, border:`1px solid ${hit?t.color:C.border}` }}>
                    <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
                      <div style={{ width:40, height:40, borderRadius:10, background:`${t.color}20`, border:`1px solid ${t.color}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>
                        {hit?"✅":"⏳"}
                      </div>
                      <div style={{ flex:1, minWidth:100 }}>
                        <div style={{ fontWeight:600, color:t.color, marginBottom:2 }}>{t.label}</div>
                        <div style={{ fontSize:12, color:C.muted }}>{hit?"Threshold reached — time to buy":`Waiting for −${t.drop}% drop`}</div>
                      </div>
                      <div style={{ display:"flex", gap:16, alignItems:"center", flexWrap:"wrap" }}>
                        <div>
                          <div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>TRIGGER</div>
                          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                            <span style={{ color:C.red, ...mono }}>−</span>
                            <input type="number" value={t.drop} onChange={e=>updateTier(i,"drop",e.target.value)}
                              style={{ width:60, padding:"6px 8px", background:C.bg, border:`1px solid ${C.border}`, borderRadius:6, color:C.text, fontSize:14, ...mono, textAlign:"center" }} />
                            <span style={{ color:C.muted }}>%</span>
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>DEPLOY</div>
                          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                            <span style={{ color:C.green, ...mono }}>$</span>
                            <input type="number" value={t.amount} onChange={e=>updateTier(i,"amount",e.target.value)}
                              style={{ width:90, padding:"6px 8px", background:C.bg, border:`1px solid ${C.border}`, borderRadius:6, color:C.text, fontSize:14, ...mono, textAlign:"center" }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={card}>
              <div style={{ marginBottom:8, fontFamily:"'DM Serif Display',serif", fontSize:16 }}>Total dry powder allocated</div>
              <div style={{ fontSize:32, fontWeight:600, ...mono, color:C.accent }}>${tiers.reduce((s,t)=>s+t.amount,0).toLocaleString()}</div>
              <div style={{ color:C.sub, fontSize:13, marginTop:6 }}>Across {tiers.length} deployment levels</div>
              <button onClick={resetPeaks} style={{ marginTop:16, padding:"8px 14px", borderRadius:6, background:"none", border:`1px solid ${C.border}`, color:C.muted, cursor:"pointer", fontSize:12 }}>
                ↺ Reset peak tracking
              </button>
            </div>
          </>
        )}

        {/* ── NEWS ── */}
        {tab === "news" && (
          <>
            <div style={{ marginBottom:20 }}>
              <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:20, marginBottom:6 }}>Market Sentiment Feed</div>
              <div style={{ color:C.sub, fontSize:13 }}>{apiReady?"Live from Finnhub news API.":"Demo headlines. Add API key for live news."}</div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:20 }}>
              {[["Bearish","bearish",C.red],["Neutral","neutral",C.muted],["Bullish","bullish",C.green]].map(([l,s,c])=>(
                <div key={l} style={{ ...card, textAlign:"center", padding:14 }}>
                  <div style={{ fontSize:28, fontWeight:600, color:c, ...mono }}>{news.filter(n=>n.sentiment===s).length}</div>
                  <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>{l} signals</div>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {news.map((n,i)=>(
                <div key={i} style={{ ...card, padding:14, display:"flex", gap:14, borderLeft:`3px solid ${n.sentiment==="bearish"?C.red:n.sentiment==="bullish"?C.green:C.border}` }}>
                  <div style={{ flexShrink:0, minWidth:64 }}>
                    <div style={{ fontSize:11, fontWeight:600, color:C.accent }}>{n.source}</div>
                    <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{n.time}</div>
                  </div>
                  <a href={n.url} target="_blank" style={{ flex:1, color:C.text, textDecoration:"none", lineHeight:1.5, fontSize:13 }}>{n.text}</a>
                  <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4, flexShrink:0, background:n.sentiment==="bearish"?"rgba(239,68,68,0.1)":n.sentiment==="bullish"?"rgba(16,185,129,0.1)":C.bg, color:n.sentiment==="bearish"?C.red:n.sentiment==="bullish"?C.green:C.muted }}>
                    {n.sentiment}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {showEmail && <EmailModal onClose={()=>setShowEmail(false)} tiers={tiers} sp500Drop={currentDrop} />}
    </div>
  );
}
