// A live status page for the demo and the video: GET /
export const BOARD_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Milo</title>
<style>
:root{--bg:#fff7ef;--fg:#2a1a10;--muted:#8a6d5a;--card:#fff;--line:#f1dcc9;--ok:#2f9e5b;--bad:#c4512b;--accent:#f07a3a}
@media (prefers-color-scheme:dark){:root{--bg:#1b130e;--fg:#f8eadf;--muted:#b89a85;--card:#26190f;--line:#3a2718}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif}
header{display:flex;align-items:center;gap:12px;padding:20px 24px}header img{width:44px;height:44px}
h1{font-size:22px;margin:0}header span{color:var(--muted)}
main{max-width:900px;margin:0 auto;padding:0 16px 40px;display:grid;gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.q{font-weight:600;font-size:18px}.meta{color:var(--muted);font-size:14px;margin:4px 0 12px}
.step{display:flex;gap:10px;padding:5px 0;font-size:16px}.step .i{width:22px;text-align:center}
.bad{color:var(--bad)}.dec{margin-top:12px;padding:12px 14px;border-radius:10px;background:color-mix(in srgb,var(--ok) 12%,transparent);border:1px solid color-mix(in srgb,var(--ok) 40%,transparent)}
.dec.no{background:color-mix(in srgb,var(--bad) 10%,transparent);border-color:color-mix(in srgb,var(--bad) 40%,transparent)}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;background:var(--accent);color:#fff;margin-left:8px}
.empty{color:var(--muted);text-align:center;padding:60px 0}
</style></head><body>
<header><img src="/logo.png" alt=""><div><h1>Milo</h1><span>the human response layer for agents</span></div></header>
<main id="m"><div class="empty">Waiting for an agent to ask something…</div></main>
<script>
const I={lookup:"🗂️",owner_agent:"🤖",slack:"💬",imessage:"📱",call:"📞",done:"✅"};
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function load(){
  let rs=[];try{rs=await (await fetch("/api/requests")).json()}catch{}
  if(!rs.length)return;
  document.getElementById("m").innerHTML=rs.slice(0,4).map(r=>{
    const steps=r.log.filter(l=>l.step!=="info").map(l=>'<div class="step '+(l.ok===false?"bad":"")+'"><span class="i">'+(l.ok===false?"✗":I[l.step]||"•")+'</span><span>'+esc(l.text)+'</span></div>').join("");
    const d=r.decision;
    const dec=d?'<div class="dec '+(d.outcome==="no_answer"?"no":"")+'"><b>'+esc(d.outcome)+'</b> · '+esc(d.answer)+(d.instead?'<br>Instead: '+esc(d.instead):'')+(d.decidedBy?'<br>Decided by '+esc(d.decidedBy)+' via '+esc(d.source.channel):'')+'</div>':'';
    return '<div class="card"><div class="q">'+esc(r.question)+(r.status==="running"?'<span class="pill">live</span>':'')+'</div><div class="meta">'+esc(r.requester)+(r.file?' · '+esc(r.file):'')+' · urgency '+esc(r.urgency)+'</div>'+steps+dec+'</div>';
  }).join("");
}
load();setInterval(load,1000);
</script></body></html>`;
