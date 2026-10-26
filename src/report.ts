import { writeFileSync, renameSync } from 'fs';
import type { CompanyRecord } from './companies';

// A single self-contained page (data embedded, no network) to browse everything
// the scout has found: sort by any column, filter by text and status.

export function writeReport(path: string, companies: Map<string, CompanyRecord>): void {
  const data = JSON.stringify([...companies.values()]).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Startup Scout</title>
<style>
:root{--bg:#fff;--fg:#1a1d29;--mut:#6b7280;--line:#e5e7eb;--acc:#2563eb}
@media(prefers-color-scheme:dark){:root{--bg:#111318;--fg:#e8eaf0;--mut:#9aa1b0;--line:#2a2e39;--acc:#6ea0ff}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,Segoe UI,sans-serif}
h1{font-size:18px;margin:0 0 4px}.sub{color:var(--mut);margin:0 0 12px}
.bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
input,select{padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{cursor:pointer;white-space:nowrap;color:var(--mut);font-weight:600}a{color:var(--acc)}
.n{text-align:right;font-variant-numeric:tabular-nums}.m{color:var(--mut);font-size:12.5px}
details summary{cursor:pointer;color:var(--acc)}ul{margin:4px 0 0;padding-left:18px}
@media(max-width:700px){.hide-s{display:none}}
</style></head><body>
<h1>Startup Scout</h1><p class="sub" id="count"></p>
<div class="bar"><input id="q" placeholder="filter name, domain, text" size="28">
<select id="st"><option value="">all statuses</option><option>researched</option><option>queued</option><option>unverified</option><option>error</option></select></div>
<table><thead><tr id="h"></tr></thead><tbody id="b"></tbody></table>
<script>
const D=${data};
const cols=[['overall','Overall',1],['name','Company',0],['growthPotential','Growth',1],['learningExperience','Learning',1],['llmTrainingCloseness','LLM',1],['status','Status',0],['firstFoundAt','Found',0]];
let key='overall',dir=-1;
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function draw(){
  const q=document.getElementById('q').value.toLowerCase(),st=document.getElementById('st').value;
  const rows=D.filter(r=>(!st||r.status===st)&&(!q||JSON.stringify(r).toLowerCase().includes(q)));
  rows.sort((a,b)=>{const x=a[key],y=b[key];if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;return (x>y?1:x<y?-1:0)*dir});
  document.getElementById('count').textContent=rows.length+' of '+D.length+' companies';
  document.getElementById('h').innerHTML=cols.map(c=>'<th data-k="'+c[0]+'" class="'+(c[2]?'n':'')+'">'+c[1]+(key===c[0]?(dir>0?' ▲':' ▼'):'')+'</th>').join('');
  document.getElementById('b').innerHTML=rows.map(r=>{
    const link=r.careersUrl||'https://'+r.domain;
    const why=(r.reasons||[]).length?'<details><summary>why</summary><ul>'+r.reasons.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'+((r.sources||[]).length?'<div class="m">'+r.sources.map(s=>'<a href="'+esc(s)+'">'+esc(s)+'</a>').join('<br>')+'</div>':'')+'</details>':'';
    return '<tr><td class="n">'+(r.overall??'')+'</td><td><a href="'+esc(link)+'">'+esc(r.name)+'</a> <span class="m">'+esc(r.domain)+'</span><div class="m">'+esc(r.blurb||'')+'</div>'+why+(r.lastError?'<div class="m">'+esc(r.lastError)+'</div>':'')+'</td><td class="n">'+(r.growthPotential??'')+'</td><td class="n">'+(r.learningExperience??'')+'</td><td class="n">'+(r.llmTrainingCloseness??'')+'</td><td>'+esc(r.status)+'</td><td class="m">'+esc((r.firstFoundAt||'').slice(0,10))+'</td></tr>';
  }).join('');
}
document.getElementById('h').onclick=e=>{const k=e.target.closest('th')?.dataset.k;if(!k)return;dir=key===k?-dir:-1;key=k;draw()};
document.getElementById('q').oninput=draw;document.getElementById('st').onchange=draw;draw();
</script></body></html>`;
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, html);
  renameSync(tmp, path);
}
