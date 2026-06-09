import { useState, useEffect, useRef } from "react";

const FINNHUB_KEY       = "d8j3349r01ql9enoepm0d8j3349r01ql9enoepmg";
const EMAILJS_SERVICE_ID  = "YOUR_SERVICE_ID";
const EMAILJS_TEMPLATE_ID = "YOUR_TEMPLATE_ID";
const EMAILJS_PUBLIC_KEY  = "YOUR_PUBLIC_KEY";

const C = {
  bg:"#0A0E1A", surface:"#111827", border:"#1E293B",
  accent:"#F59E0B", red:"#EF4444", green:"#10B981",
  purple:"#8B5CF6", muted:"#64748B", text:"#F1F5F9", sub:"#94A3B8",
};

const SYMBOLS = [
  { key:"sp500",  ticker:"SPY", name:"S&P 500", label:"SPX" },
  { key:"nasdaq", ticker:"QQQ", name:"Nasdaq",  label:"QQQ" },
  { key:"vix",    ticker:"VIX", name:"VIX",     label:"VIX" },
];

const CRASHES = [
  { name:"Black Monday", year:1987, color:"#8B5CF6",
    curve:Array.from({length:60},(_,i)=>{ if(i<2)return 100-i*17; if(i<10)return 66-(i-2)*1.5; if(i<40)return 54+(i-10)*1.5; return Math.min(100,99+(i-40)*0.05); }),
    totalDrop:34, recoveryDays:504, cause:"Program trading cascade" },
  { name:"Dot-com", year:2000, color:"#EC4899",
    curve:Array.from({length:60},(_,i)=>{ if(i<5)return 100-i*3; if(i<50)return 85-(i-5)*0.8; return Math.max(49,85-45*0.8+(i-50)*0.3); }),
    totalDrop:49, recoveryDays:2500, cause:"Tech bubble burst" },
  { name:"GFC 2008", year:2008, color:"#EF4444",
    curve:Array.from({length:60},(_,i)=>{ if(i<3)return 100-i*3; if(i<30)return 91-(i-3)*1.6; if(i<45)return 48-(i-30)*0.1; return Math.min(100,47+(i-45)*1.1); }),
    totalDrop:57, recoveryDays:1500, cause:"Subprime mortgage crisis" },
  { name:"COVID 2020", year:2020, color:"#F59E0B",
    curve:Array.from({length:60},(_,i)=>{ if(i<23)return 100-i*1.55; return Math.min(100,64.4+(i-23)*1.5); }),
    totalDrop:34, recoveryDays:148, cause:"COVID-19 pandemic" },
];

const DEFAULT_TIERS = [
  { drop:10, amount:500,  label:"Dip",        color:C.accent },
  { drop:20, amount:500,  label:"Correction", color:"#F97316" },
  { drop:30, amount:1000, label:"Crash",      color:C.red },
  { drop:50, amount:2000, label:"Crisis",     color:"#9F1239" },
];

// ── Crash Score engine ────────────────────────────────────────────
// Weights: drawdown 50%, VIX 30%, Fear&Greed 20%
function calcCrashScore(drawdownPct, vix, fearGreed) {
  const d = Math.abs(drawdownPct ?? 0);
  // drawdown: 0%=0pts, 10%=20pts, 20%=40pts, 30%=60pts, 50%=100pts
  const drawdownScore = Math.min(100, (d / 50) * 100);
  // VIX: 10=0pts, 20=30pts, 30=60pts, 45+=100pts
  const vixScore = Math.min(100, Math.max(0, ((vix ?? 15) - 10) / 35 * 100));
  // Fear&Greed: 0=Extreme Fear=100pts, 50=neutral=50pts, 100=Greed=0pts
  const fgScore = fearGreed !== null ? (100 - (fearGreed ?? 50)) : 50;
  return Math.round(drawdownScore * 0.5 + vixScore * 0.3 + fgScore * 0.2);
}

function getRegime(score) {
  if (score >= 80) return { label:"Panic",      color:"#9F1239", emoji:"🔴" };
  if (score >= 60) return { label:"Crash",      color:C.red,     emoji:"🚨" };
  if (score >= 40) return { label:"Bear",       color:"#F97316", emoji:"🟠" };
  if (score >= 20) return { label:"Correction", color:C.accent,  emoji:"🟡" };
  return               { label:"Normal",      color:C.green,   emoji:"🟢" };
}

function getDecision(score, tiers, currentDrop) {
  const hit = [...tiers].reverse().find(t => Math.abs(currentDrop) >= t.drop);
  if (!hit) {
    const next = tiers.find(t => Math.abs(currentDrop) < t.drop);
    return { action:"Hold", detail: next ? `Next buy at −${next.drop}% (${(next.drop - Math.abs(currentDrop)).toFixed(1)}% away)` : "Watching…", color:C.muted };
  }
  return { action:`Buy $${hit.amount.toLocaleString()}`, detail:`${hit.label} threshold reached (−${Math.abs(currentDrop).toFixed(1)}%)`, color:C.green };
}

// ── API helpers ───────────────────────────────────────────────────
async function fetchQuote(ticker) {
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function fetchFearGreed() {
  try {
    const res = await fetch("https://fear-and-greed-index.p.rapidapi.com/v1/fgi", {
      headers: { "X-RapidAPI-Key": "demo", "X-RapidAPI-Host": "fear-and-greed-index.p.rapidapi.com" }
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d?.fgi?.now?.value ?? null;
  } catch { return null; }
}

async function fetchNews() {
  const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data || []).slice(0, 8).map(n => ({
    time:      new Date(n.datetime * 1000).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }),
    source:    n.source,
    text:      n.headline,
    sentiment: n.sentiment > 0.1 ? "bullish" : n.sentiment < -0.1 ? "bearish" : "neutral",
    url:       n.url,
  }));
}

function getStoredPeak(key, current) {
  try {
    const s = JSON.parse(localStorage.getItem("cwPeaks") || "{}");
    const peak = Math.max(s[key] || current, current);
    localStorage.setItem("cwPeaks", JSON.stringify({ ...s, [key]: peak }));
    return peak;
  } catch { return current; }
}

function resetPeaks() { try { localStorage.removeItem("cwPeaks"); } catch {} }

// ── Crash chart ───────────────────────────────────────────────────
function CrashChart({ currentDrop, currentDay, tiers }) {
  const W = 560, H = 200;
  const xS = d => (d / 60) * W;
  const yS = v => H - ((v - 40) / 65) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:"auto" }}>
      {[100, 80, 60].map(v => (
        <g key={v}>
          <line x1={0} y1={yS(v)} x2={W} y2={yS(v)} stroke={C.border} strokeWidth="1" strokeDasharray="4,4" />
          <text x={4} y={yS(v)-3} fontSize="9" fill={C.muted}>{v}%</text>
        </g>
      ))}
      {CRASHES.map(c => (
        <g key={c.name}>
          <polyline points={c.curve.map((v,i)=>`${xS(i)},${yS(v)}`).join(" ")}
            fill="none" stroke={c.color} strokeWidth="1.5" strokeOpacity="0.75" strokeLinejoin="round" />
          <text x={xS(59)+4} y={yS(c.curve[59])} fontSize="9" fill={c.color}>{c.name}</text>
        </g>
      ))}
      {currentDay !== null && (
        <g>
          <line x1={xS(currentDay)} y1={0} x2={xS(currentDay)} y2={H} stroke={C.accent} strokeWidth="1.5" strokeDasharray="4,3" />
          <circle cx={xS(currentDay)} cy={yS(100+currentDrop)} r="4" fill={C.accent} />
          <text x={xS(currentDay)+6} y={yS(100+currentDrop)-5} fontSize="9" fill={C.accent} fontWeight="600">NOW</text>
        </g>
      )}
      {tiers.map(t => (
        <line key={t.drop} x1={0} y1={yS(100-t.drop)} x2={W} y2={yS(100-t.drop)}
          stroke={t.color} strokeWidth="0.75" strokeOpacity="0.5" strokeDasharray="3,3" />
      ))}
    </svg>
  );
}

// ── Crash Score gauge ─────────────────────────────────────────────
function ScoreGauge({ score, regime }) {
  const r = 54, cx = 70, cy = 70;
  const circ = Math.PI * r; // half circle
  const pct = score / 100;
  const dash = pct * circ;
  return (
    <svg width={140} height={80} style={{ overflow:"visible" }}>
      {/* Track */}
      <path d={`M ${cx-r},${cy} A ${r},${r} 0 0,1 ${cx+r},${cy}`}
        fill="none" stroke={C.border} strokeWidth="10" strokeLinecap="round" />
      {/* Fill */}
      <path d={`M ${cx-r},${cy} A ${r},${r} 0 0,1 ${cx+r},${cy}`}
        fill="none" stroke={regime.color} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`} style={{ transition:"stroke-dasharray 0.6s" }} />
      <text x={cx} y={cy-6} textAnchor="middle" fontSize="24" fontWeight="700"
        fill={regime.color} fontFamily="DM Mono, monospace">{score}</text>
      <text x={cx} y={cy+10} textAnchor="middle" fontSize="11" fill={C.sub}>{regime.label}</text>
    </svg>
  );
}

// ── Email modal ───────────────────────────────────────────────────
function EmailModal({ onClose, tiers, sp500Drop }) {
  const [email, setEmail] = useState(localStorage.getItem("cwEmail") || "");
  const [sent, setSent]   = useState(false);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState("");

  const send = async () => {
    if (!email.includes("@")) return;
    if (EMAILJS_PUBLIC_KEY === "YOUR_PUBLIC_KEY") { setErr("EmailJS not configured yet."); return; }
    setBusy(true);
    try {
      const { default: emailjs } = await import("https://cdn.jsdelivr.net/npm/@emailjs/browser@3/+esm");
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        to_email: email, subject: "CrashWatch — Test Alert",
        sp500_drop: sp500Drop?.toFixed(2) ?? "N/A",
        tiers: tiers.map(t=>`${t.label} (−${t.drop}%): $${t.amount}`).join("\n"),
        message: "Your CrashWatch alerts are active.",
      }, EMAILJS_PUBLIC_KEY);
      localStorage.setItem("cwEmail", email);
      setSent(true);
    } catch(e) { setErr("Send failed: "+e.message); }
    setBusy(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:32, width:460, maxWidth:"90vw" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
          <span style={{ fontSize:18, fontWeight:600, fontFamily:"'DM Serif Display',serif", color:C.text }}>Email Alerts</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:20 }}>✕</button>
        </div>
        {sent ? (
          <div style={{ textAlign:"center", padding:"20px 0" }}>
            <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
            <p style={{ color:C.text, fontSize:15 }}>Test sent to {email}</p>
          </div>
        ) : (
          <>
            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:11, color:C.muted, display:"block", marginBottom:6 }}>YOUR EMAIL</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com"
                style={{ width:"100%", padding:"10px 14px", background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, color:C.text, fontSize:14, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:18 }}>
              <label style={{ fontSize:11, color:C.muted, display:"block", marginBottom:8 }}>THRESHOLDS</label>
              {tiers.map((t,i)=>(
                <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ width:8, height:8, borderRadius:"50%", background:t.color, flexShrink:0 }} />
                  <span style={{ color:C.sub, fontSize:13, flex:1 }}>{t.label} (−{t.drop}%)</span>
                  <span style={{ color:t.color, fontSize:13, fontWeight:600 }}>Deploy ${t.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div style={{ marginBottom:14, padding:12, background:C.bg, borderRadius:8, border:`1px solid ${C.border}`, fontSize:12, color:C.sub, lineHeight:1.7 }}>
              <strong style={{ color:C.accent }}>⚙️ Setup (free, 5 min):</strong><br/>
              1. Sign up at <a href="https://emailjs.com" target="_blank" style={{ color:C.accent }}>emailjs.com</a><br/>
              2. Add Gmail service → create template with: <code style={{ color:C.text }}>{"{{to_email}} {{subject}} {{message}} {{tiers}} {{sp500_drop}}"}</code><br/>
              3. Paste Service ID, Template ID, Public Key at top of App.jsx
            </div>
            {err && <p style={{ color:C.red, fontSize:12, marginBottom:10 }}>{err}</p>}
            <button onClick={send} disabled={busy||!email.includes("@")} style={{ width:"100%", padding:"11px", borderRadius:8, background:email.includes("@")?C.accent:C.border, color:email.includes("@")?"#000":C.muted, border:"none", fontSize:14, fontWeight:600, cursor:email.includes("@")?"pointer":"default" }}>
              {busy?"Sending…":"Send test & save"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ apiReady }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
      <div style={{ width:7, height:7, borderRadius:"50%", background:apiReady?C.green:C.accent }} />
      <span style={{ fontSize:11, color:C.muted, fontFamily:"'DM Mono',monospace" }}>{apiReady?"LIVE":"DEMO"}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,       setTab]       = useState("dashboard");
  const [market,    setMarket]    = useState(null);
  const [fearGreed, setFearGreed] = useState(null);
  const [news,      setNews]      = useState([]);
  const [tiers,     setTiers]     = useState(DEFAULT_TIERS);
  const [showEmail, setShowEmail] = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [lastUpdate,setLastUpdate]= useState(null);
  const [apiReady,  setApiReady]  = useState(false);
  const [error,     setError]     = useState("");
  const alertedTiers = useRef(new Set());

  const fetchMarket = async () => {
    const configured = FINNHUB_KEY !== "YOUR_FINNHUB_KEY_HERE";
    setApiReady(configured);

    if (!configured) {
      setMarket({
        sp500:  { value:5432, name:"S&P 500", label:"SPX", changePct:-1.00, fromPeak:-8.2  },
        nasdaq: { value:17210,name:"Nasdaq",  label:"QQQ", changePct:-0.98, fromPeak:-11.4 },
        vix:    { value:18.4, name:"VIX",     label:"VIX", changePct:13.6,  fromPeak:null  },
      });
      setFearGreed(32); // demo: Fear
      setLoading(false);
      setLastUpdate(new Date());
      return;
    }
    try {
      const results = await Promise.allSettled(SYMBOLS.map(s => fetchQuote(s.ticker)));
      const updated = {};
      SYMBOLS.forEach((s, i) => {
        const r = results[i];
        if (r.status === "fulfilled") {
          const d = r.value;
          const peak = getStoredPeak(s.key, d.c);
          updated[s.key] = {
            value: d.c, name: s.name, label: s.label,
            changePct: d.dp,
            fromPeak: s.key !== "vix" ? ((d.c - peak) / peak) * 100 : null,
          };
        }
      });
      if (Object.keys(updated).length > 0) { setMarket(updated); setError(""); }
      const fg = await fetchFearGreed();
      setFearGreed(fg);
      setLastUpdate(new Date());
    } catch(e) { setError("API error: "+e.message); }
    setLoading(false);
  };

  const fetchMarketNews = async () => {
    const configured = FINNHUB_KEY !== "YOUR_FINNHUB_KEY_HERE";
    if (!configured) {
      setNews([
        { time:"2m",  source:"Reuters",    sentiment:"bearish", text:"Fed signals rates unchanged through Q3 amid inflation concerns", url:"#" },
        { time:"14m", source:"Bloomberg",  sentiment:"bearish", text:"Hedge fund net short positions hit 18-month high on S&P futures", url:"#" },
        { time:"31m", source:"CNBC",       sentiment:"neutral", text:"Q2 earnings season begins — analysts expect 4.2% YoY growth", url:"#" },
        { time:"1h",  source:"WSJ",        sentiment:"bearish", text:"Goldman cuts S&P 500 year-end target citing valuation stretch", url:"#" },
        { time:"2h",  source:"FT",         sentiment:"bullish", text:"Labor market remains resilient — jobless claims fall 3rd week", url:"#" },
        { time:"3h",  source:"Axios",      sentiment:"bearish", text:"Volatility derivatives signal elevated crash risk into Q3", url:"#" },
      ]);
      return;
    }
    try { const d = await fetchNews(); if (d.length > 0) setNews(d); } catch {}
  };

  const checkThresholds = (mkt) => {
    if (!mkt?.sp500) return;
    const drop = Math.abs(mkt.sp500.fromPeak || 0);
    tiers.forEach(t => {
      if (drop >= t.drop && !alertedTiers.current.has(t.drop)) {
        alertedTiers.current.add(t.drop);
        if (EMAILJS_PUBLIC_KEY !== "YOUR_PUBLIC_KEY") {
          import("https://cdn.jsdelivr.net/npm/@emailjs/browser@3/+esm").then(({ default: ejs }) => {
            const em = localStorage.getItem("cwEmail");
            if (em) ejs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
              to_email: em,
              subject: `🚨 CrashWatch — Market down ${drop.toFixed(1)}% (${t.label})`,
              message: `S&P 500 hit your ${t.label} threshold. Deploy $${t.amount.toLocaleString()}.`,
              sp500_drop: drop.toFixed(2),
              tiers: `${t.label} triggered — deploy $${t.amount}`,
            }, EMAILJS_PUBLIC_KEY);
          });
        }
      }
    });
  };

  useEffect(() => {
    fetchMarket(); fetchMarketNews();
    const i1 = setInterval(fetchMarket, 30000);
    const i2 = setInterval(fetchMarketNews, 300000);
    return () => { clearInterval(i1); clearInterval(i2); };
  }, []);

  useEffect(() => { if (market) checkThresholds(market); }, [market]);

  const sp          = market?.sp500;
  const vix         = market?.vix?.value ?? 15;
  const currentDrop = sp?.fromPeak ?? -8.2;
  const currentDay  = 12; // days since drawdown started — future: derive from stored peak date
  const crashScore  = calcCrashScore(currentDrop, vix, fearGreed);
  const regime      = getRegime(crashScore);
  const decision    = getDecision(crashScore, tiers, currentDrop);
  const nextTier    = tiers.find(t => Math.abs(currentDrop) < t.drop);
  const matchedCrash = CRASHES.reduce((best,c) =>
    Math.abs(c.totalDrop-Math.abs(currentDrop)) < Math.abs(best.totalDrop-Math.abs(currentDrop)) ? c : best
  , CRASHES[0]);
  const updateTier = (i, f, v) => { const u=[...tiers]; u[i]={...u[i],[f]:Number(v)}; setTiers(u); };

  const card = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:20 };
  const mono = { fontFamily:"'DM Mono',monospace" };

  const fgLabel = fearGreed === null ? "N/A"
    : fearGreed <= 20 ? "Extreme Fear"
    : fearGreed <= 40 ? "Fear"
    : fearGreed <= 60 ? "Neutral"
    : fearGreed <= 80 ? "Greed" : "Extreme Greed";
  const fgColor = fearGreed === null ? C.muted
    : fearGreed <= 20 ? C.red
    : fearGreed <= 40 ? "#F97316"
    : fearGreed <= 60 ? C.muted
    : fearGreed <= 80 ? C.green : "#10B981";

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
          {lastUpdate && <span style={{ fontSize:11, color:C.muted, ...mono }}>{lastUpdate.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>}
          <button onClick={()=>{fetchMarket();fetchMarketNews();}} style={{ padding:"6px 12px", borderRadius:6, background:C.surface, border:`1px solid ${C.border}`, color:C.sub, cursor:"pointer", fontSize:12 }}>↻</button>
          <button onClick={()=>setShowEmail(true)} style={{ padding:"8px 16px", borderRadius:8, background:C.accent, border:"none", color:"#000", fontWeight:600, cursor:"pointer", fontSize:13 }}>🔔 Alerts</button>
        </div>
      </div>

      {!apiReady && (
        <div style={{ padding:"10px 24px", background:"rgba(245,158,11,0.08)", borderBottom:`1px solid rgba(245,158,11,0.2)`, fontSize:12, color:C.accent, display:"flex", gap:8, alignItems:"center" }}>
          ⚡ Demo mode — <span style={{ color:C.sub }}>add Finnhub API key at top of App.jsx.</span>
          <a href="https://finnhub.io" target="_blank" style={{ color:C.accent }}>finnhub.io</a>
        </div>
      )}
      {error && <div style={{ padding:"10px 24px", background:"rgba(239,68,68,0.08)", borderBottom:`1px solid rgba(239,68,68,0.2)`, fontSize:12, color:C.red }}>{error}</div>}

      {/* Nav */}
      <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, padding:"0 24px" }}>
        {[["dashboard","📊 Dashboard"],["crashes","📉 Crash History"],["strategy","⚡ Strategy"],["news","📰 News"]].map(([t,label])=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:"12px 18px", background:"none", border:"none", borderBottom:tab===t?`2px solid ${C.accent}`:"2px solid transparent", color:tab===t?C.accent:C.muted, cursor:"pointer", fontSize:13, fontWeight:tab===t?600:400, transition:"all 0.15s" }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding:24, maxWidth:960, margin:"0 auto" }}>

        {/* ── DASHBOARD ── */}
        {tab === "dashboard" && (
          <>
            {/* Decision banner */}
            <div style={{ padding:"16px 20px", borderRadius:12, marginBottom:20, background:`${regime.color}12`, border:`1px solid ${regime.color}40`, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:24 }}>{regime.emoji}</span>
                <div>
                  <div style={{ fontWeight:700, color:regime.color, fontSize:15 }}>{regime.label} Market — {decision.action}</div>
                  <div style={{ color:C.sub, fontSize:12, marginTop:2 }}>{decision.detail}</div>
                </div>
              </div>
              <ScoreGauge score={crashScore} regime={regime} />
            </div>

            {/* Market cards + Fear & Greed */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:12, marginBottom:24 }}>
              {market && Object.values(market).map(m=>(
                <div key={m.label} style={{ ...card, borderLeft:`3px solid ${(m.changePct??0)<0?C.red:C.green}`, padding:16 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                    <div>
                      <div style={{ fontSize:11, color:C.muted, ...mono }}>{m.label}</div>
                      <div style={{ fontSize:12, color:C.sub }}>{m.name}</div>
                    </div>
                    <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4, background:(m.changePct??0)<0?"rgba(239,68,68,0.1)":"rgba(16,185,129,0.1)", color:(m.changePct??0)<0?C.red:C.green, ...mono }}>
                      {(m.changePct??0)>0?"+":""}{(m.changePct??0).toFixed(2)}%
                    </span>
                  </div>
                  <div style={{ fontSize:22, fontWeight:600, ...mono }}>
                    {m.label==="VIX"?m.value?.toFixed(2):Math.round(m.value??0).toLocaleString()}
                  </div>
                  {m.fromPeak!==null&&m.fromPeak!==undefined&&(
                    <div style={{ marginTop:6, fontSize:11, color:C.red, ...mono }}>{m.fromPeak.toFixed(1)}% from peak</div>
                  )}
                  {m.label==="VIX"&&(
                    <div style={{ marginTop:6, fontSize:11, color:m.value>30?C.red:m.value>20?C.accent:C.green }}>
                      {m.value>30?"Extreme fear":m.value>20?"Elevated fear":m.value>15?"Moderate":"Calm"}
                    </div>
                  )}
                </div>
              ))}
              {/* Fear & Greed card */}
              <div style={{ ...card, borderLeft:`3px solid ${fgColor}`, padding:16 }}>
                <div style={{ fontSize:11, color:C.muted, ...mono, marginBottom:4 }}>FEAR & GREED</div>
                <div style={{ fontSize:12, color:C.sub, marginBottom:8 }}>CNN Index</div>
                <div style={{ fontSize:22, fontWeight:600, ...mono, color:fgColor }}>
                  {fearGreed !== null ? fearGreed : "—"}
                </div>
                <div style={{ marginTop:6, fontSize:11, color:fgColor }}>{fgLabel}</div>
              </div>
            </div>

            {/* Crash Score breakdown */}
            <div style={{ ...card, marginBottom:24 }}>
              <div style={{ marginBottom:14, fontFamily:"'DM Serif Display',serif", fontSize:16 }}>Crash Score Breakdown</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
                {[
                  ["Drawdown (50%)", `−${Math.abs(currentDrop).toFixed(1)}%`, Math.min(100,(Math.abs(currentDrop)/50)*100), C.red],
                  ["VIX Level (30%)", vix.toFixed(1), Math.min(100,Math.max(0,(vix-10)/35*100)), C.accent],
                  ["Fear & Greed (20%)", fearGreed!==null?fearGreed:"N/A", fearGreed!==null?(100-fearGreed):50, C.purple],
                ].map(([label, val, pct, color])=>(
                  <div key={label} style={{ padding:14, background:C.bg, borderRadius:10, border:`1px solid ${C.border}` }}>
                    <div style={{ fontSize:11, color:C.muted, marginBottom:6 }}>{label}</div>
                    <div style={{ fontSize:18, fontWeight:600, ...mono, color, marginBottom:8 }}>{val}</div>
                    <div style={{ height:4, background:C.border, borderRadius:2 }}>
                      <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:2, transition:"width 0.5s" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Strategy bar */}
            <div style={{ ...card, marginBottom:24 }}>
              <div style={{ marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontFamily:"'DM Serif Display',serif", fontSize:16 }}>Deployment Plan</span>
                <span style={{ fontSize:12, color:C.muted }}>SPY {currentDrop.toFixed(1)}% from peak</span>
              </div>
              <div style={{ position:"relative", height:8, background:C.border, borderRadius:4, marginBottom:20 }}>
                <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${Math.min(100,Math.abs(currentDrop)/55*100)}%`, background:`linear-gradient(90deg,${C.accent},${C.red})`, borderRadius:4 }} />
                {tiers.map(t=>(
                  <div key={t.drop} style={{ position:"absolute", left:`${(t.drop/55)*100}%`, top:-4, width:2, height:16, background:t.color, borderRadius:1 }} />
                ))}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10 }}>
                {tiers.map((t,i)=>{
                  const hit = Math.abs(currentDrop)>=t.drop;
                  return (
                    <div key={i} style={{ padding:"10px 14px", borderRadius:8, background:hit?`${t.color}15`:C.bg, border:`1px solid ${hit?t.color:C.border}`, opacity:hit?1:0.55 }}>
                      <div style={{ fontSize:11, color:t.color, fontWeight:600, marginBottom:4 }}>{hit?"✓ ":""}{t.label} (−{t.drop}%)</div>
                      <div style={{ fontSize:16, fontWeight:600, ...mono }}>${t.amount.toLocaleString()}</div>
                      <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{hit?"Deploy now":"Pending"}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Closest crash match */}
            <div style={card}>
              <div style={{ marginBottom:12, fontFamily:"'DM Serif Display',serif", fontSize:16 }}>Closest Historical Match</div>
              <div style={{ display:"flex", alignItems:"center", gap:16, padding:16, background:C.bg, borderRadius:10 }}>
                <div style={{ width:4, alignSelf:"stretch", borderRadius:2, background:matchedCrash.color, flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:15, fontWeight:600, color:matchedCrash.color, marginBottom:4 }}>{matchedCrash.name} ({matchedCrash.year})</div>
                  <div style={{ color:C.sub, fontSize:13, marginBottom:10 }}>{matchedCrash.cause}</div>
                  <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
                    {[["Total drop",`−${matchedCrash.totalDrop}%`,C.red],["Recovery",matchedCrash.recoveryDays<365?`${matchedCrash.recoveryDays}d`:`${(matchedCrash.recoveryDays/365).toFixed(1)}yr`,C.green],["Potential bottom",`~−${matchedCrash.totalDrop}%`,C.accent]].map(([l,v,c])=>(
                      <div key={l}><div style={{ fontSize:11, color:C.muted }}>{l}</div><div style={{ color:c, ...mono, fontWeight:600 }}>{v}</div></div>
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
              <div style={{ color:C.sub, fontSize:13 }}>SPY is {currentDrop.toFixed(1)}% below its recent peak. Dotted lines = your buy thresholds.</div>
            </div>
            <div style={{ ...card, marginBottom:20 }}>
              <CrashChart currentDrop={currentDrop} currentDay={currentDay} tiers={tiers} />
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
              <div style={{ color:C.sub, fontSize:13 }}>Edit thresholds and amounts. Email alerts fire when each level is hit.</div>
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
                        <div style={{ fontSize:12, color:C.muted }}>{hit?"Deploy now":`Waiting for −${t.drop}% drop`}</div>
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
              <div style={{ marginBottom:8, fontFamily:"'DM Serif Display',serif", fontSize:16 }}>Total dry powder</div>
              <div style={{ fontSize:32, fontWeight:600, ...mono, color:C.accent }}>${tiers.reduce((s,t)=>s+t.amount,0).toLocaleString()}</div>
              <div style={{ color:C.sub, fontSize:13, marginTop:6 }}>Across {tiers.length} levels</div>
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
              <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:20, marginBottom:6 }}>Market Sentiment</div>
              <div style={{ color:C.sub, fontSize:13 }}>{apiReady?"Live from Finnhub.":"Demo headlines."}</div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:20 }}>
              {[["Bearish","bearish",C.red],["Neutral","neutral",C.muted],["Bullish","bullish",C.green]].map(([l,s,c])=>(
                <div key={l} style={{ ...card, textAlign:"center", padding:14 }}>
                  <div style={{ fontSize:28, fontWeight:600, color:c, ...mono }}>{news.filter(n=>n.sentiment===s).length}</div>
                  <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>{l}</div>
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
