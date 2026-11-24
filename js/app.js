// Capsule Vault: a Dragon Ball S.H.Figuarts collection tracker.
// Data flow: an action changes `state` -> persist() saves it -> render() redraws the screen.
import { RAW } from './catalog.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, AI_ENABLED } from './config.js';

// Supabase client (accounts, database, photo storage). null = local-only mode.
const sb = (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
let myUid = null;      // the signed-in user's id, or null
let dirty = false;     // true while a change hasn't reached the cloud yet


const SER={D:'Dragon Ball',Z:'Dragon Ball Z',S:'Dragon Ball Super',GT:'Dragon Ball GT',DA:'Dragon Ball Daima',G:'Games'};
const SCOL={D:'#ff8a1c',Z:'#ff4d3d',S:'#38bdf8',GT:'#c084fc',DA:'#4ade80',G:'#f472b6','':'#9aa0c0'};
const TYP={R:'Retail',W:'Web exclusive',E:'Event exclusive',S:'Store exclusive',C:'Custom'};
const RAR={R:1,W:2,S:3,E:4,C:0};
const RARN=['Unknown','Common','Uncommon','Rare','Ultra rare'];
const NOW=new Date().toISOString().slice(0,7); // current month, e.g. 2026-11
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CAT=RAW.trim().split('\n').map(l=>{const [id,n,d,t,s]=l.split('|');return{id:'b'+id,no:id,n,d,t,s}});
const KEY='capsule-vault-v1';
const $=i=>document.getElementById(i);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>(v<0?'-':'')+'$'+Math.abs(Math.round(v)).toLocaleString('en-US');
const money2=v=>'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2});
const pct=v=>(v>0?'+':'')+(v*100).toFixed(1)+'%';
const fd=d=>{if(!d)return'';const[y,m]=d.split('-');return (MON[+m-1]||'')+' '+y};
const num=v=>{const n=parseFloat(v);return isFinite(n)&&n>=0?n:null};
const stars=n=>n?'★'.repeat(n)+'☆'.repeat(4-n):'';
// A photo is stored as a path in the 'photos' bucket: "<user id>/<file>.jpg"
const okId=v=>typeof v==='string'&&/^[0-9a-f-]{36}\/[\w.-]{1,80}$/.test(v);
const photoUrl=p=>sb?sb.storage.from('photos').getPublicUrl(p).data.publicUrl:'';
const fresh=()=>({items:{},custom:[]});
const norm=o=>{const s=fresh();if(o&&typeof o==='object'){if(o.items&&typeof o.items==='object')s.items=o.items;if(Array.isArray(o.custom))s.custom=o.custom.filter(c=>c&&c.id&&c.n);if(Array.isArray(o.badges))s.badges=o.badges.filter(b=>typeof b==='string');if(o.sc&&typeof o.sc==='object')s.sc={on:!!o.sc.on,name:String(o.sc.name||'').slice(0,40),vals:!!o.sc.vals}}return s};
let state=fresh();
try{const r=localStorage.getItem(KEY);if(r)state=norm(JSON.parse(r))}catch(e){}
let view='all',year=null,cur=null,ref=null,assets=null,writing=false,again=false,saveT=null;
const all=()=>CAT.concat(state.custom.map(c=>({id:c.id,no:'',n:c.n,d:c.d||'',t:'C',s:''})));
const it=id=>state.items[id]||{};
const valOf=x=>{const i=it(x.id);const h=i.hist||[];return i.val!=null?i.val:(h.length?h[h.length-1][1]:null)};
const capSvg=(s,big)=>`<svg viewBox="0 0 16 16" style="color:${SCOL[s]||SCOL['']}" aria-hidden="true"><use href="#cap"/></svg>`;
const isDeal=x=>{const i=it(x.id);if(i.s!=='want'||i.target==null)return false;const v=valOf(x);return v!=null&&v<=i.target};
const thumb=(x,i)=>okId(i.photo)?`<img src="${esc(photoUrl(i.photo))}" alt="" loading="lazy">`:capSvg(x.s);

function setSync(t){$('sync').textContent=t}
function persist(){
  dirty=true;
  try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}
  if(ref){clearTimeout(saveT);saveT=setTimeout(flush,700)}
}
async function flush(){
  if(!ref)return;
  if(writing){again=true;return}
  writing=true;
  try{
    // upsert = insert the row, or update it if this user already has one
    const {error}=await sb.from('vaults').upsert({user_id:myUid,data:state,updated_at:new Date().toISOString()});
    if(error)throw error;
    dirty=false;setSync('Synced to your account. Open it on any device.');
  }
  catch(e){setSync('Saved on this device. Sync will retry on your next change.')}
  writing=false;
  if(again){again=false;flush();return}
  if(state.sc&&state.sc.on)pushShowcase();
}

/* ---------- Undo ---------- */
let undoSnap=null,undoTm=null,pendingDel=null;
function snap(msg){
  undoSnap=JSON.stringify(state);
  $('undoT').textContent=msg;$('undo').classList.add('show');
  clearTimeout(undoTm);undoTm=setTimeout(hideUndo,6000);
}
function hideUndo(){$('undo').classList.remove('show');undoSnap=null}
$('undoB').addEventListener('click',()=>{
  if(!undoSnap)return;
  if(pendingDel){clearTimeout(pendingDel.t);pendingDel=null}
  state=norm(JSON.parse(undoSnap));persist();hideUndo();
  if(cur){if(all().some(f=>f.id===cur))fill();else close()}
  render();
});

/* ---------- Showcase ---------- */
const SITE=location.origin+location.pathname;
let scWriting=false,scAgain=false;
const toHex=s=>[...new TextEncoder().encode(s)].map(b=>b.toString(16).padStart(2,'0')).join('');
const fromHex=h=>{try{return new TextDecoder().decode(new Uint8Array(h.match(/../g).map(x=>parseInt(x,16))))}catch(e){return null}};
const scLink=()=>myUid?SITE+'#sc-'+myUid:'';
function scDoc(){
  const L=all().filter(x=>it(x.id).s==='own').sort((a,b)=>(a.d||'9').localeCompare(b.d||'9'));
  const vals=!!(state.sc&&state.sc.vals);let total=0;
  const figs=L.map(x=>{const i=it(x.id),v=valOf(x);if(v!=null)total+=v;const f={n:x.n,d:x.d||'',s:x.s||''};if(vals&&v!=null)f.v=v;if(okId(i.photo))f.p=i.photo;return f});
  const d={name:(state.sc&&state.sc.name)||'',count:figs.length,figs,updated:new Date().toISOString().slice(0,10)};
  if(vals)d.total=Math.round(total);
  return d;
}
async function pushShowcase(){
  if(!sb||!myUid)return;
  if(scWriting){scAgain=true;return}
  scWriting=true;
  try{
    const {error}=await sb.from('showcases').upsert({user_id:myUid,data:scDoc(),updated_at:new Date().toISOString()});
    if(error)throw error;
    $('scMsg').textContent='Showcase is live and updates automatically when your shelf changes.';
  }
  catch(e){$('scMsg').textContent="Couldn't update your showcase. Try again in a moment."}
  scWriting=false;if(scAgain){scAgain=false;pushShowcase()}
}
function scPanel(){
  const on=!!(state.sc&&state.sc.on),ok=!!(sb&&myUid);
  $('scPub').textContent=on?'UPDATE NOW':'PUBLISH';
  $('scPub').disabled=!ok;
  for(const id of ['scCopy','scView','scDown'])$(id).classList.toggle('hide',!on||!ok);
  if(document.activeElement!==$('scName'))$('scName').value=(state.sc&&state.sc.name)||'';
  $('scVals').checked=!!(state.sc&&state.sc.vals);
  if(!ok)$('scMsg').textContent=sb?'Sign in to publish a showcase.':'Showcases need the cloud setup from the README.';
}
$('scPub').addEventListener('click',()=>{state.sc={on:true,name:$('scName').value.trim().slice(0,40),vals:$('scVals').checked};persist();pushShowcase();scPanel()});
$('scName').addEventListener('change',()=>{state.sc=Object.assign({on:false,vals:false},state.sc,{name:$('scName').value.trim().slice(0,40)});persist()});
$('scVals').addEventListener('change',()=>{state.sc=Object.assign({on:false,name:''},state.sc,{vals:$('scVals').checked});persist()});
$('scCopy').addEventListener('click',async()=>{const l=scLink();try{await navigator.clipboard.writeText(l);$('scMsg').textContent='Link copied. Anyone with it can view your shelf.'}catch(e){$('scMsg').textContent='Your link: '+l}});
$('scView').addEventListener('click',()=>{location.hash='sc-'+myUid});
$('scDown').addEventListener('click',async()=>{if(!sb||!myUid)return;try{const {error}=await sb.from('showcases').delete().eq('user_id',myUid);if(error)throw error;state.sc=Object.assign({},state.sc,{on:false});persist();scPanel();$('scMsg').textContent='Showcase taken down. The link no longer shows your shelf.'}catch(e){$('scMsg').textContent="Couldn't take it down. Try again."}});

async function route(){
  const m=/^#sc-([0-9a-f-]{36})$/.exec(location.hash);
  document.body.classList.toggle('scmode',!!m);$('scPage').classList.toggle('hide',!m);
  if(!m)return;
  window.scrollTo(0,0);
  const uid=m[1];
  $('spName').textContent='SHOWCASE';$('spSub').textContent='Loading...';$('spSum').textContent='';$('spShelf').innerHTML='';
  if(!sb){$('spSub').textContent='Showcases need the cloud setup from the README.';return}
  try{
    // Anyone can read showcases (the database rule allows it), signed in or not.
    const {data:row,error}=await sb.from('showcases').select('data').eq('user_id',uid).maybeSingle();
    if(error)throw error;
    if(!row){$('spSub').textContent="This showcase isn't public right now. It may have been taken down.";return}
    const d=row.data||{},figs=Array.isArray(d.figs)?d.figs:[];
    const nm=String(d.name||'').slice(0,40);
    $('spName').textContent=nm?nm.toUpperCase()+"'S VAULT":'A COLLECTOR’S VAULT';
    $('spSub').textContent=`${figs.length} Dragon Ball S.H.Figuarts on display`+(typeof d.updated==='string'?' · updated '+d.updated:'');
    $('spSum').textContent=typeof d.total==='number'&&d.total>0?'Collection value about '+money(d.total):'';
    $('spShelf').innerHTML=figs.length?figs.map(f=>{const x={s:typeof f.s==='string'?f.s:''};return `<div class="sh"><span class="pic">${okId(f.p)?`<img src="${esc(photoUrl(f.p))}" alt="" loading="lazy">`:capSvg(x.s)}</span><span class="cap">${esc(f.n)}</span><span class="pv">${typeof f.v==='number'?esc(money2(f.v)):'&nbsp;'}</span></div>`}).join(''):'<p class="empty" style="grid-column:1/-1">This shelf is empty for now.</p>';
  }catch(e){$('spSub').textContent="Couldn't load this showcase right now."}
}
window.addEventListener('hashchange',route);
$('spBack').addEventListener('click',()=>{location.hash='';route();render()});

function stats(){
  const L=all();let own=0,paid=0,val=0,want=0,soon=0,deal=0;
  for(const x of L){const i=it(x.id);if(x.d>NOW)soon++;if(i.s==='want')want++;if(isDeal(x))deal++;if(i.s==='own'){own++;paid+=i.paid||0;const v=valOf(x);val+=v!=null?v:(i.paid||0)}}
  $('sOwn').textContent=own+'/'+L.length;$('sOwnL').textContent='figures owned';
  $('sVal').textContent=money(val);$('sPaid').textContent=money(paid);
  const g=val-paid;$('sGain').textContent=(g>0?'+':'')+money(g);
  $('sGainBox').className='st'+(g>0?' g':g<0?' r':'');
  $('cAll').textContent=L.length;$('cOwn').textContent=own;$('cWant').textContent=want;$('cSoon').textContent=soon;
  $('cDeal').textContent=deal;$('tDeal').classList.toggle('hot',deal>0);
  return L;
}
function timeline(L){
  const ys={};for(let y=2009;y<=2027;y++)ys[y]={n:0,o:0};
  for(const x of L){const y=+String(x.d).slice(0,4);if(ys[y]){ys[y].n++;if(it(x.id).s==='own')ys[y].o++}}
  const max=Math.max(...Object.values(ys).map(v=>v.n),1);
  const keys=Object.keys(ys);
  $('yrs').innerHTML=keys.map(y=>{const v=ys[y];return `<button class="yr${year===y?' on':''}" data-y="${y}" aria-label="${y}: ${v.n} releases, ${v.o} owned"><span class="n">${v.n}</span><span class="b" style="height:${v.n/max*100}%"><span class="o" style="height:${v.n?v.o/v.n*100:0}%"></span></span></button>`}).join('');
  $('lbl').innerHTML=keys.map((y,i)=>`<span>${i%3===0||i===keys.length-1?"'"+y.slice(2):''}</span>`).join('');
  $('tlT').textContent=year?`YEAR ${year} · TAP TO CLEAR`:'RELEASES BY YEAR';
}
function list(L){
  const q=$('q').value.trim().toLowerCase(),fs=$('fs').value,ft=$('ft').value,so=$('so').value;
  let r=L.filter(x=>{const i=it(x.id);
    if(view==='own'&&i.s!=='own')return false;
    if(view==='want'&&i.s!=='want')return false;
    if(view==='soon'&&!(x.d>NOW))return false;
    if(view==='deal'&&!isDeal(x))return false;
    if(year&&!String(x.d).startsWith(year))return false;
    if(fs&&x.s!==fs)return false;if(ft&&x.t!==ft)return false;
    if(q&&!(x.n.toLowerCase().includes(q)||(i.notes||'').toLowerCase().includes(q)))return false;
    return true});
  const g=x=>{const v=valOf(x),p=it(x.id).paid;return v!=null&&p!=null?v-p:-1e12};
  r.sort(so==='old'?(a,b)=>a.d.localeCompare(b.d):so==='az'?(a,b)=>a.n.localeCompare(b.n):so==='val'?(a,b)=>(valOf(b)??-1)-(valOf(a)??-1):so==='gain'?(a,b)=>g(b)-g(a):so==='rare'?(a,b)=>RAR[b.t]-RAR[a.t]||a.d.localeCompare(b.d):(a,b)=>b.d.localeCompare(a.d));
  if(!r.length){$('list').innerHTML=`<li class="empty">${view==='own'?'NO FIGURES YET. Tap OWN on any figure in the roster.':view==='want'?'WISHLIST EMPTY. Tap WANT on a figure to add it.':view==='deal'?'NO DEALS YET. Set a wishlist target price, then log values. When a value drops to your target, it shows up here.':'NO MATCH. Try another search or filter.'}</li>`;return}
  $('list').innerHTML=r.map(x=>{const i=it(x.id),v=valOf(x);let vh='';
    if(v!=null){const d=i.paid!=null?v-i.paid:null;vh=esc(money2(v))+(d!=null&&d!==0?`<small class="${d>0?'up':'dn'}">${d>0?'+':'-'}${esc(money(Math.abs(d)))}</small>`:'')}
    else if(i.s==='want'&&i.target!=null)vh=`<small>target ${esc(money2(i.target))}</small>`;
    const soon=(x.d>NOW?' · <span class="soon">COMING</span>':'')+(isDeal(x)?'<span class="deal">DEAL</span>':'');
    return `<li class="row" data-id="${esc(x.id)}"><button class="open" data-act="open"><span class="th">${thumb(x,i)}</span><span class="nm">${esc(x.n)}</span><span class="meta">${esc(fd(x.d))} · ${esc(SER[x.s]||'Your entry')} · <span class="stars" title="${RARN[RAR[x.t]]}">${stars(RAR[x.t])}</span>${soon}</span></button><span class="val">${vh}</span><span class="tg"><button class="own" data-act="own" aria-pressed="${i.s==='own'}">OWN</button><button class="want" data-act="want" aria-pressed="${i.s==='want'}">WANT</button></span></li>`}).join('');
}
const CHARS=[
  ['Son Goku',n=>/goku/i.test(n)&&!/goku black/i.test(n)],
  ['Vegeta',n=>/vegeta/i.test(n)],
  ['Son Gohan',n=>/gohan/i.test(n)],
  ['Piccolo',n=>/piccolo/i.test(n)&&!/king piccolo/i.test(n)],
  ['Frieza',n=>/frieza/i.test(n)],
  ['Trunks',n=>/trunks/i.test(n)],
  ['Krillin',n=>/krillin/i.test(n)],
  ['Broly',n=>/broly/i.test(n)],
  ['Cell',n=>/\bcell\b/i.test(n)],
  ['Androids',n=>/android/i.test(n)],
  ['Majin Buu',n=>/buu/i.test(n)],
  ['Vegito & Gogeta',n=>/vegito|gogeta/i.test(n)],
  ['Goku Black & Zamasu',n=>/goku black|zamasu/i.test(n)],
  ['Beerus & Whis',n=>/beerus|\bwhis\b/i.test(n)],
  ['Ginyu Force',n=>/ginyu|jeice|recoome|burter|guldo/i.test(n)],
  ['Cooler',n=>/cooler/i.test(n)]
];
function achievements(L){
  const owned=L.filter(x=>it(x.id).s==='own');
  let val=0,doubled=0,dayOne=0;
  for(const x of owned){const i=it(x.id),v=valOf(x);val+=v!=null?v:(i.paid||0);if(v!=null&&i.paid&&v>=2*i.paid)doubled=1;if(i.date&&x.d&&i.date.slice(0,7)===x.d)dayOne=1}
  const logs=Object.values(state.items).reduce((a,i)=>a+((i.hist||[]).length),0);
  const photos=Object.values(state.items).filter(i=>okId(i.photo)).length;
  const series=new Set(owned.map(x=>x.s).filter(Boolean)).size;
  const maxChar=Math.max(0,...CHARS.map(([,f])=>owned.filter(x=>f(x.n)).length));
  const ys={};for(const x of L){if(!x.d||x.d>NOW||x.t==='C')continue;const y=x.d.slice(0,4);(ys[y]=ys[y]||[]).push(x)}
  const fullYear=Object.values(ys).some(a=>a.length>=2&&a.every(x=>it(x.id).s==='own'))?1:0;
  const c=t=>owned.filter(x=>x.t===t).length;
  return [
    ['first','FIRST CAPSULE','Own your first figure',owned.length,1],
    ['squad','SQUAD UP','Own 10 figures',owned.length,10],
    ['elite','ELITE WARRIOR','Own 25 figures',owned.length,25],
    ['legend','LEGENDARY COLLECTOR','Own 50 figures',owned.length,50],
    ['god','GOD TIER','Own 100 figures',owned.length,100],
    ['9000',"IT'S OVER 9000","Collection worth over $9,000",Math.round(val),9001,1],
    ['event','EVENT HUNTER','Own 5 event exclusives',c('E'),5],
    ['web','WEB WARRIOR','Own 10 web exclusives',c('W'),10],
    ['multi','MULTIVERSE','Own figures from 5 different series',series,5],
    ['fan','SUPER FAN','Own 10 figures of one character',maxChar,10],
    ['old','OLD SCHOOL','Own a figure released 2009 to 2012',owned.filter(x=>x.d&&x.d<'2013').length,1],
    ['year','FULL YEAR','Own every release from one year',fullYear,1],
    ['day1','DAY ONE','Buy a figure in its release month',dayOne,1],
    ['power','POWER UP','Own a figure worth 2x what you paid',doubled,1],
    ['scout','PRICE SCOUT','Log 25 prices',logs,25],
    ['photo','PHOTOGRAPHER','Add 10 photos of your figures',photos,10],
    ['dream','DREAM LIST','Put 10 figures on your wishlist',L.filter(x=>it(x.id).s==='want').length,10],
    ['deal','DEAL SPOTTER','Catch a wishlist figure at your target',L.filter(isDeal).length,1]
  ].map(([id,name,desc,cur,goal,isMoney])=>({id,name,desc,cur:Math.min(cur,goal),goal,isMoney,got:cur>=goal}));
}
let toastQ=[],toasting=false;
function toast(title,msg){toastQ.push([title,msg]);if(!toasting)nextToast()}
function nextToast(){
  const t=toastQ.shift(),el=$('toast');if(!t){toasting=false;el.classList.remove('show');return}
  toasting=true;el.innerHTML=`<svg viewBox="0 0 16 16" aria-hidden="true"><use href="#medal"/></svg><div><b>${esc(t[0])}</b><span>${esc(t[1])}</span></div>`;
  el.classList.add('show');setTimeout(()=>{el.classList.remove('show');setTimeout(nextToast,400)},2800);
}
function checkBadges(A){
  const got=A.filter(a=>a.got).map(a=>a.id);
  if(!Array.isArray(state.badges)){state.badges=got;return}
  const fresh=A.filter(a=>a.got&&!state.badges.includes(a.id));
  if(!fresh.length)return;
  for(const a of fresh)toast('BADGE UNLOCKED',a.name);
  state.badges=[...new Set(state.badges.concat(got))];persist();
}
function badges(L,A){
  const n=A.filter(a=>a.got).length;
  $('bSum').textContent=`BADGES · ${n} OF ${A.length} UNLOCKED`;
  $('bgrid').innerHTML=A.map(a=>`<div class="bdg ${a.got?'got':'lock'}"><svg viewBox="0 0 16 16" aria-hidden="true"><use href="#medal"/></svg><div><b>${esc(a.name)}</b><span>${esc(a.desc)}</span><div class="prog" title="${a.cur} of ${a.goal}"><i style="width:${a.cur/a.goal*100}%"></i></div><span>${a.got?'Unlocked':esc(a.isMoney?money(a.cur)+' of '+money(a.goal):a.cur+' of '+a.goal)}</span></div></div>`).join('');
  const cat=L.filter(x=>x.t!=='C');
  $('chars').innerHTML=CHARS.map(([name,f])=>{const all=cat.filter(x=>f(x.n)),o=all.filter(x=>it(x.id).s==='own').length;return `<button class="chr${o&&o===all.length?' done':''}" data-c="${esc(name)}"><span>${esc(name)}</span><span class="prog"><i style="width:${all.length?o/all.length*100:0}%"></i></span><em>${o}/${all.length}</em></button>`}).join('');
}
function shelfView(L){
  const o=L.filter(x=>it(x.id).s==='own').sort((a,b)=>(a.d||'9').localeCompare(b.d||'9'));
  let val=0;for(const x of o){const v=valOf(x);val+=v!=null?v:(it(x.id).paid||0)}
  $('shSum').textContent=o.length?`${o.length} figure${o.length===1?'':'s'} on display · worth ${money(val)} · oldest first`:'';
  $('shelf').innerHTML=o.length?o.map(x=>{const i=it(x.id),v=valOf(x);return `<button class="sh" data-id="${esc(x.id)}" aria-label="${esc(x.n)}"><span class="pic">${thumb(x,i)}</span><span class="cap">${esc(x.n)}</span><span class="pv">${v!=null?esc(money2(v)):'&nbsp;'}</span></button>`}).join(''):`<p class="empty" style="grid-column:1/-1">YOUR SHELF IS EMPTY. Tap OWN on figures in the roster to put them on display.</p>`;
}
function render(){
  const L=stats();timeline(L);const A=achievements(L);
  const sv=view==='shelf',bv=view==='badges',av=view==='ai';
  $('list').classList.toggle('hide',sv||bv||av);$('vShelf').classList.toggle('hide',!sv);$('vBadges').classList.toggle('hide',!bv);$('vAi').classList.toggle('hide',!av);$('fbox').classList.toggle('hide',sv||bv||av);
  $('cBadge').textContent=A.filter(a=>a.got).length;
  if(sv){shelfView(L);scPanel()}else if(bv)badges(L,A);else if(av)aiAvail();else list(L);
  checkBadges(A);
}
function setView(v){view=v;for(const t of $('tabs').querySelectorAll('[data-v]'))t.setAttribute('aria-pressed',String(t.dataset.v===v));render()}

function wishPick(){
  const bud=num($('wBud').value);const out=$('wRes');
  try{if(bud!=null)localStorage.setItem('capsule-vault-budget',String(bud))}catch(e){}
  const W=all().filter(x=>it(x.id).s==='want');
  if(!W.length){out.innerHTML='<p>Your wishlist is empty. Tap WANT on a few figures first, then come back and make a wish.</p>';return}
  const est=x=>{const v=valOf(x);return v!=null?v:(it(x.id).target??null)};
  let pool=bud==null?W:W.filter(x=>est(x)!=null&&est(x)<=bud),note='';
  if(!pool.length){
    const unk=W.filter(x=>est(x)==null);
    if(unk.length){pool=unk;note="Nothing on your wishlist has a known price inside that budget, so here's one with no price logged yet. Check eBay sold to see if it fits."}
    else{const ch=W.slice().sort((a,b)=>est(a)-est(b))[0];out.innerHTML=`<p>Every wishlist figure is over ${esc(money(bud))}. The cheapest is <b>${esc(ch.n)}</b> at about ${esc(money2(est(ch)))}, so you'd need ${esc(money(est(ch)-bud))} more.</p>`;return}
  }
  const bag=[];for(const x of pool){bag.push(x);if(isDeal(x))bag.push(x,x)}
  const x=bag[Math.floor(Math.random()*bag.length)],i=it(x.id),e=est(x);
  const why=isDeal(x)?'It is at or under your target price right now.':e!=null&&bud!=null?`It fits your budget with ${money(bud-e)} to spare.`:'';
  out.innerHTML=`<div class="wport">${thumb(x,i)}</div><h3>YOUR WISH IS GRANTED</h3><p style="color:var(--ink);font-size:1.15em">${esc(x.n)}</p><p>${e!=null?'About '+esc(money2(e))+(valOf(x)==null?' (your target)':''):'No price logged yet'}${isDeal(x)?' <span class="deal">DEAL</span>':''}</p><p>${esc(why||note)}</p><div class="acts"><button class="pbtn" id="wAgain">WISH AGAIN</button><button class="pbtn gold" id="wOpen" data-id="${esc(x.id)}">OPEN FIGURE</button></div>`;
}

function upd(id,patch){
  const i=Object.assign({},it(id),patch);
  for(const k in i)if(i[k]===null||i[k]===''||(Array.isArray(i[k])&&!i[k].length))delete i[k];
  if(Object.keys(i).length)state.items[id]=i;else delete state.items[id];
  persist();
}

function months(a,b){const[ya,ma]=a.split('-').map(Number),[yb,mb]=b.split('-').map(Number);return (yb-ya)*12+(mb-ma)}
function age(d){if(!d)return'—';const m=months(d,NOW);if(m<0)return 'in '+(-m)+' mo';const y=Math.floor(m/12),r=m%12;return (y?y+' yr ':'')+(r||!y?r+' mo':'')}

function chart(){
  const s=$('eChart');if(!cur){s.innerHTML='';return}
  const h=it(cur).hist||[],W=s.clientWidth,H=s.clientHeight;if(!W)return;
  if(h.length<2){s.innerHTML=`<text class="ct-t" x="${W/2}" y="${H/2}" text-anchor="middle">${h.length?'Log one more value to see the trend':'No prices logged yet. Log a sale below.'}</text>`;return}
  const L=56,R=14,T=16,B=26,vs=h.map(p=>p[1]),paid=it(cur).paid;
  let mn=Math.min(...vs,paid??Infinity),mx=Math.max(...vs,paid??-Infinity);if(mx===mn){mx+=1;mn=Math.max(0,mn-1)}
  const X=k=>L+k/(h.length-1)*(W-L-R),Y=v=>T+(1-(v-mn)/(mx-mn))*(H-T-B);
  const up=vs[vs.length-1]>=vs[0],cs=getComputedStyle(document.documentElement),c=(cs.getPropertyValue(up?'--up':'--dn')||(up?'#4ade80':'#ff5a5a')).trim();
  let g='';for(const v of [mn,(mn+mx)/2,mx]){g+=`<line class="ct-g" x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ct-t" x="${L-6}" y="${Y(v)+5}" text-anchor="end">${esc(money(v))}</text>`}
  if(paid!=null)g+=`<line class="ct-p" x1="${L}" x2="${W-R}" y1="${Y(paid)}" y2="${Y(paid)}"/><text class="ct-pt" x="${W-R}" y="${Y(paid)-5}" text-anchor="end">paid</text>`;
  const step=h.map((p,k)=>(k?`H${X(k)}V${Y(p[1])}`:`M${X(0)},${Y(p[1])}`)).join('');
  const lbl=W<520?[0,h.length-1]:[0,Math.floor((h.length-1)/2),h.length-1];
  g+=[...new Set(lbl)].map(k=>`<text class="ct-t" x="${X(k)}" y="${H-6}" text-anchor="${k===0?'start':k===h.length-1?'end':'middle'}">${esc(h[k][0])}</text>`).join('');
  s.innerHTML=g+`<path d="${step}" fill="none" stroke="${esc(c)}" stroke-width="3" shape-rendering="crispEdges"/>`+h.map((p,k)=>`<rect class="ct-pt2" x="${X(k)-4}" y="${Y(p[1])-4}" width="8" height="8" fill="${esc(c)}"/>`).join('');
}
const ro=new ResizeObserver(chart);ro.observe($('eFig'));

function fill(){
  const x=all().find(f=>f.id===cur);if(!x)return close();const i=it(cur);
  $('eName').textContent=x.n;
  $('eMeta').textContent=[x.no?'#'+x.no:'',fd(x.d),SER[x.s]||'Your entry',TYP[x.t]].filter(Boolean).join(' · ')+(x.d>NOW?' · COMING':'');
  $('ePort').innerHTML=(okId(i.photo)?`<img src="${esc(photoUrl(i.photo))}" alt="Your photo of ${esc(x.n)}">`:capSvg(x.s))+`<span class="tag">${okId(i.photo)?'YOUR PHOTO':'NO PHOTO YET'}</span>`;
  const qn=encodeURIComponent('S.H.Figuarts '+x.n);
  $('eG').href='https://www.google.com/search?tbm=isch&q='+qn;
  $('eB').href='https://www.ebay.com/sch/i.html?_nkw='+qn+'&LH_Sold=1&LH_Complete=1';
  $('eUp').classList.toggle('hide',!assets);$('eRm').classList.toggle('hide',!assets||!okId(i.photo));
  if(!assets)$('eUpMsg').textContent=sb?'Sign in to upload photos.':'Photo uploads need the cloud setup from the README.';else $('eUpMsg').textContent='';
  const v=valOf(x),p=i.paid,h=i.hist||[];
  $('eLv').textContent=v!=null?money2(v):'--';
  const hp=$('eHp');
  if(v!=null&&p){const r=v/p;hp.classList.toggle('neg',r<1);hp.firstElementChild.style.width=Math.min(100,Math.max(4,r>=1?50+Math.min(50,(r-1)*50):r*50))+'%';$('eHpT').textContent=(v-p>=0?'+':'-')+money(Math.abs(v-p))+' ('+pct(v/p-1)+') vs what you paid'}
  else{hp.classList.remove('neg');hp.firstElementChild.style.width='0%';$('eHpT').textContent=v==null?'Log a value to charge the power level.':'Add what you paid to see gain or loss.'}
  const today=new Date().toISOString().slice(0,10);
  const held=i.date?Math.max(0,Math.round((Date.parse(today)-Date.parse(i.date))/864e5)):null;
  const ann=held&&held>=30&&p&&v!=null?Math.pow(v/p,365/held)-1:null;
  const vs=h.map(q=>q[1]);
  const owned=all().filter(f=>it(f.id).s==='own'&&valOf(f)!=null).sort((a,b)=>valOf(b)-valOf(a));
  const rank=owned.findIndex(f=>f.id===cur);
  const rows=[
    ['Released',fd(x.d)||'—'],['Age',age(x.d)],
    ['Sold as',TYP[x.t]],['Rarity',x.t==='C'?'—':stars(RAR[x.t])+' '+RARN[RAR[x.t]]],
    ['Original retail',i.msrp!=null?money2(i.msrp):'—'],['Value vs retail',i.msrp&&v!=null?pct(v/i.msrp-1):'—'],
    ['Days owned',held!=null?held.toLocaleString():'—'],['Yearly return',ann!=null?pct(ann):'—'],
    ['All-time high',vs.length?money2(Math.max(...vs)):'—'],['All-time low',vs.length?money2(Math.min(...vs)):'—'],
    ['Change since 1st log',vs.length>1?pct(vs[vs.length-1]/vs[0]-1):'—'],['Prices logged',String(vs.length)],
    ['Rank in your vault',rank>=0?'#'+(rank+1)+' of '+owned.length:'—'],['Gap to target',i.target!=null&&v!=null?(v-i.target>0?money(v-i.target)+' over':money(i.target-v)+' under'):'—']
  ];
  $('eKv').innerHTML=rows.map(([k,val])=>`<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join('');
  for(const b of $('eSeg').children)b.setAttribute('aria-pressed',String((i.s||'')===b.dataset.s));
  $('ePaid').value=i.paid??'';$('eVal').value=i.val??'';$('eMsrp').value=i.msrp??'';$('eCond').value=i.cond||'';$('eDate').value=i.date||'';$('eTarget').value=i.target??'';$('eNotes').value=i.notes||'';
  $('eHist').innerHTML=h.map((q,k)=>`<li><span>${esc(q[0])}</span><span>${esc(money2(q[1]))} <button data-k="${k}" aria-label="Remove entry">✕</button></span></li>`).reverse().join('');
  $('eDel').classList.toggle('hide',x.t!=='C');
  chart();
}
function open(id){cur=id;$('scrim').classList.add('show');fill();setTimeout(()=>{chart();$('eX').focus()},30)}
function close(){$('scrim').classList.remove('show');cur=null;render()}

$('list').addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const id=b.closest('.row').dataset.id;const a=b.dataset.act;
  if(a==='open')return open(id);
  const x=all().find(f=>f.id===id),off=it(id).s===a;
  snap((off?'Removed from ':'Added to ')+(a==='own'?'owned':'wishlist')+': '+(x?x.n:''));
  upd(id,{s:off?null:a});render();
});
$('yrs').addEventListener('click',e=>{const b=e.target.closest('.yr');if(!b)return;year=year===b.dataset.y?null:b.dataset.y;render()});
$('tabs').addEventListener('click',e=>{const b=e.target.closest('[data-v]');if(!b)return;setView(b.dataset.v)});
$('shelf').addEventListener('click',e=>{const b=e.target.closest('.sh');if(b)open(b.dataset.id)});
$('chars').addEventListener('click',e=>{const b=e.target.closest('.chr');if(!b)return;const n=b.dataset.c.split(' & ')[0].replace('Son ','');$('q').value=n==='Androids'?'Android':n==='Ginyu Force'?'Ginyu':n;$('fs').value='';$('ft').value='';$('so').value='old';year=null;setView('all');window.scrollTo({top:$('tabs').getBoundingClientRect().top+scrollY-10})});
$('wBtn').addEventListener('click',()=>{try{const b=localStorage.getItem('capsule-vault-budget');if(b&&!$('wBud').value)$('wBud').value=b}catch(e){}$('wRes').innerHTML='';$('wish').classList.add('show');setTimeout(()=>$('wBud').focus(),30)});
const closeWish=()=>$('wish').classList.remove('show');
$('wX').addEventListener('click',closeWish);
$('wish').addEventListener('click',e=>{if(e.target===$('wish'))return closeWish();const b=e.target.closest('button');if(!b)return;if(b.id==='wAgain')wishPick();if(b.id==='wOpen'){const id=b.dataset.id;closeWish();open(id)}});
$('wGo').addEventListener('click',wishPick);
$('wBud').addEventListener('keydown',e=>{if(e.key==='Enter')wishPick()});
['q','fs','ft','so'].forEach(k=>$(k).addEventListener('input',render));
$('fs').innerHTML+=Object.entries(SER).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
$('ft').innerHTML+=Object.entries(TYP).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');

$('eSeg').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const s=b.dataset.s||null;if((it(cur).s||null)===s)return;snap(s==='own'?'Marked as owned':s==='want'?'Moved to wishlist':'No longer tracked');upd(cur,{s});fill()});
[['ePaid','paid',num],['eVal','val',num],['eMsrp','msrp',num],['eTarget','target',num],['eCond','cond',v=>v||null],['eDate','date',v=>v||null],['eNotes','notes',v=>v.trim().slice(0,2000)||null]].forEach(([el,k,f])=>$(el).addEventListener('change',()=>{upd(cur,{[k]:f($(el).value)});if(k==='paid'&&it(cur).paid!=null&&it(cur).s!=='own')upd(cur,{s:'own'});fill()}));
$('eLogB').addEventListener('click',()=>{const v=num($('eLog').value);if(v==null)return $('eLog').focus();snap('Logged '+money2(v));const h=(it(cur).hist||[]).slice();h.push([new Date().toISOString().slice(0,10),v]);upd(cur,{hist:h.slice(-60),val:v});$('eLog').value='';fill()});
$('eHist').addEventListener('click',e=>{const b=e.target.closest('button[data-k]');if(!b)return;snap('Price entry deleted');const h=(it(cur).hist||[]).slice();h.splice(+b.dataset.k,1);upd(cur,{hist:h});fill()});
$('eDone').addEventListener('click',close);$('eX').addEventListener('click',close);
$('scrim').addEventListener('click',e=>{if(e.target===$('scrim'))close()});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(cur)close();else{closeWish();$('auth').classList.remove('show')}});
$('eDel').addEventListener('click',()=>{snap('Entry deleted');state.custom=state.custom.filter(c=>c.id!==cur);delete state.items[cur];persist();close()});

// Photos go to Supabase Storage under the user's own folder (the storage rule only allows that folder).
async function uploadPhoto(blob){
  const type=blob.type==='image/png'||blob.type==='image/webp'?blob.type:'image/jpeg';
  const ext=type.split('/')[1].replace('jpeg','jpg');
  const path=`${myUid}/${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}.${ext}`;
  const {error}=await sb.storage.from('photos').upload(path,blob,{contentType:type,upsert:false});
  if(error)throw error;
  return {id:path};
}
async function deletePhoto(p){try{await sb.storage.from('photos').remove([p])}catch(e){}}
async function shrink(file){
  const bmp=await createImageBitmap(file);const k=Math.min(1,900/Math.max(bmp.width,bmp.height));
  const c=document.createElement('canvas');c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);
  c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
  return await new Promise(r=>c.toBlob(r,'image/jpeg',.85));
}
$('eUp').addEventListener('click',()=>$('eFile').click());
$('eFile').addEventListener('change',async()=>{
  const f=$('eFile').files[0];$('eFile').value='';if(!f||!assets||!cur)return;
  const id=cur;$('eUpMsg').textContent='Uploading...';
  try{let blob=f;try{blob=await shrink(f)||f}catch(e){}
    const a=await uploadPhoto(blob);upd(id,{photo:a.id});$('eUpMsg').textContent='Photo saved.';if(cur===id)fill();render()}
  catch(e){$('eUpMsg').textContent="That photo couldn't be uploaded. Try a smaller image."}
});
$('eRm').addEventListener('click',()=>{
  const p=it(cur).photo;snap('Photo removed');upd(cur,{photo:null});fill();render();
  if(pendingDel){clearTimeout(pendingDel.t);const old=pendingDel.p;pendingDel=null;if(assets&&okId(old))deletePhoto(old)}
  if(assets&&okId(p))pendingDel={p,t:setTimeout(()=>{pendingDel=null;deletePhoto(p)},7000)};
});

$('nAdd').addEventListener('click',()=>{const n=$('nName').value.trim().slice(0,140);if(!n)return $('nName').focus();const c={id:'c'+Date.now().toString(36),n,d:$('nDate').value||''};state.custom.push(c);$('nName').value='';$('nDate').value='';persist();render();open(c.id)});
$('bCopy').addEventListener('click',async()=>{const t=JSON.stringify({app:'capsule-vault',v:1,...state});try{await navigator.clipboard.writeText(t);$('bMsg').textContent='Copied.'}catch(e){$('rTxt').value=t;$('bMsg').textContent='Copy blocked here. The backup is in the Load box; select and copy it.'}});
$('rGo').addEventListener('click',()=>{try{const o=JSON.parse($('rTxt').value);if(!o||typeof o.items!=='object')throw 0;snap('Backup loaded');state=norm(o);persist();render();$('rMsg').textContent='Backup loaded.';$('rTxt').value=''}catch(e){$('rMsg').textContent="That doesn't look like a Capsule Vault backup."}});

/* ---------- AI Lab ----------
   The browser never sees the Anthropic API key. It sends requests to our own
   server function (supabase/functions/ai), which checks the user is signed in,
   adds the secret key and forwards the request to Claude. */
const today=()=>new Date().toISOString().slice(0,10);
const aiOn=()=>!!(sb&&myUid);
const MAX_IMAGES=4;

// One request to Claude through our server function. Returns {content, stop_reason}.
async function callAI(body){
  if(!aiOn())throw {code:'signin'};
  const {data,error}=await sb.functions.invoke('ai',{body});
  if(error){
    let msg='',status=0;
    try{status=error.context.status;const j=await error.context.json();msg=j.error||''}catch(e){}
    throw {code:status===401?'signin':status===429?'rate_limited':'upstream',message:msg};
  }
  return data;
}
// Turn a photo into base64 text, shrunk first so uploads stay small and cheap.
async function toB64(file){
  let blob=file;try{blob=await shrink(file)||file}catch(e){}
  const type=['image/jpeg','image/png','image/webp','image/gif'].includes(blob.type)?blob.type:'image/jpeg';
  const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=rej;r.readAsDataURL(blob)});
  return {type:'image',source:{type:'base64',media_type:type,data}};
}
// Ask for JSON and parse it tolerantly: whole reply, a ```json fence, or the first {...} block.
function parseJSON(text){
  const t=String(text||'').trim();
  try{return JSON.parse(t)}catch(e){}
  const f=t.match(/```(?:json)?\s*([\s\S]*?)```/);if(f){try{return JSON.parse(f[1])}catch(e){}}
  const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a>=0&&b>a){try{return JSON.parse(t.slice(a,b+1))}catch(e){}}
  throw {code:'invalid_json'};
}
const textOf=r=>(r&&Array.isArray(r.content)?r.content:[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').trim();
async function aiJson(prompt,images=[]){
  const parts=[];for(const f of images.slice(0,MAX_IMAGES))parts.push(await toB64(f));
  parts.push({type:'text',text:prompt});
  const r=await callAI({tier:'smart',max_tokens:1200,messages:[{role:'user',content:parts}]});
  return parseJSON(textOf(r));
}
function aiErr(e){
  const c=e&&e.code;
  return {signin:'Sign in to use the AI Lab.',rate_limited:'Too many requests right now. Wait a minute and try again.',invalid_json:'The AI gave an unreadable answer. Try again.',cancelled:'Stopped.'}[c]
    ||(e&&e.message?'AI error: '+e.message:'Something went wrong reaching the AI. Try again.');
}
function aiAvail(){
  let msg='';
  if(!sb)msg='The AI Lab needs the cloud setup from the README.';
  else if(!myUid)msg='Sign in to use the AI Lab.';
  $('aiOff').textContent=msg;
  for(const id of ['idPick','btPick','btGo','askGo'])$(id).disabled=!aiOn();
}
$('aiSeg').addEventListener('click',e=>{const b=e.target.closest('[data-t]');if(!b)return;for(const x of $('aiSeg').children){x.setAttribute('aria-pressed',String(x===b));$(x.dataset.t).classList.toggle('hide',x!==b)}});
$('catList').innerHTML=CAT.map(x=>`<option value="${esc(x.n)}">`).join('');

/* Snap to identify */
let idBlob=null,idUrl=null;
$('idPick').addEventListener('click',()=>$('idFile').click());
$('idFile').addEventListener('change',async()=>{
  const f=$('idFile').files[0];$('idFile').value='';if(!f||!aiOn())return;
  idBlob=f;if(idUrl)URL.revokeObjectURL(idUrl);idUrl=URL.createObjectURL(f);
  $('idPrev').innerHTML=`<img src="${idUrl}" alt="Your photo">`;
  const out=$('idOut');out.innerHTML='<p class="thinking">Scanning the roster for a match</p>';$('idPick').disabled=true;
  const cat=CAT.map(x=>`${x.id}|${x.n}|${fd(x.d)}|${SER[x.s]}|${TYP[x.t]}`).join('\n');
  const prompt=`You identify Bandai S.H.Figuarts Dragon Ball action figures from a photo. The photo shows one figure, loose or in its box. Match it to the catalog below using the character, form or transformation (hair colour, aura, eyes), outfit, accessories and any box text you can read. "Event Exclusive Color" and "Premium Color" editions are recolours of earlier releases, and reissues look like the originals, so lower your confidence when variants are hard to tell apart and list them as alternatives.
Catalog lines are id|name|release|series|sold as.

CATALOG:
${cat}

Reply with only JSON in this shape:
{"is_figure":true,"character":"who it shows","matches":[{"id":"b2","confidence":85,"why":"short reason"}],"tip":"one short tip for a better photo if unsure, else empty"}
Give up to 3 matches, best first, confidence 0-100, ids only from the catalog. If the photo is not a Dragon Ball figure, set is_figure to false and matches to [].`;
  try{
    const r=await aiJson(prompt,[f]);
    const ms=(Array.isArray(r&&r.matches)?r.matches:[]).map(m=>({x:CAT.find(c=>c.id===String(m&&m.id)),c:Math.max(0,Math.min(100,Math.round(Number(m&&m.confidence)||0))),why:String((m&&m.why)||'').slice(0,240)})).filter(m=>m.x).slice(0,3);
    if(!r||r.is_figure===false||!ms.length){out.innerHTML=`<p>${r&&r.is_figure===false?"That doesn't look like a Dragon Ball S.H.Figuarts figure.":"No confident match in the catalog."} ${esc(String((r&&r.tip)||'Try a clear, well-lit photo of the front of the figure.').slice(0,300))}</p><p class="note">If it's a newer release, add it with New Entry at the bottom of the page.</p>`;return}
    out.innerHTML=(r.character?`<p class="aih">LOOKS LIKE ${esc(String(r.character).slice(0,80).toUpperCase())}</p>`:'')+ms.map((m,k)=>{const i=it(m.x.id);return `<div class="match${k?'':' top'}"><span class="th">${thumb(m.x,i)}</span><div><span class="nm">${esc(m.x.n)}</span><span class="meta">${esc(fd(m.x.d))} · ${esc(SER[m.x.s])} · ${esc(TYP[m.x.t])}${i.s==='own'?' · <b>OWNED</b>':''}</span><div class="conf"><span class="prog"><i style="width:${m.c}%"></i></span><em>${m.c}% sure</em></div><p class="why">${esc(m.why)}</p><div class="pacts"><button class="pbtn gold" data-add="${esc(m.x.id)}">${i.s==='own'?'USE AS PHOTO':'ADD TO OWNED'}</button><button class="pbtn" data-open="${esc(m.x.id)}">OPEN</button></div></div></div>`}).join('')+(r.tip?`<p class="note">${esc(String(r.tip).slice(0,300))}</p>`:'')+'<p class="note">AI guesses can be wrong, especially between recolours and reissues. Check before you add.</p>';
  }catch(e){out.innerHTML=`<p class="msg err">${esc(aiErr(e))}</p>`}
  finally{aiAvail()}
});
$('idOut').addEventListener('click',async e=>{
  const o=e.target.closest('[data-open]');if(o)return open(o.dataset.open);
  const b=e.target.closest('[data-add]');if(!b)return;const id=b.dataset.add;const x=CAT.find(c=>c.id===id);if(!x)return;
  snap('Added to owned: '+x.n);if(it(id).s!=='own')upd(id,{s:'own'});render();
  b.disabled=true;b.textContent='ADDED';
  if(assets&&idBlob&&!okId(it(id).photo)){try{let blob=idBlob;try{blob=await shrink(idBlob)||idBlob}catch(_){}const a=await uploadPhoto(blob);upd(id,{photo:a.id});render();b.textContent='ADDED WITH PHOTO'}catch(_){b.textContent='ADDED (PHOTO FAILED)'}}
});

/* Bootleg red flags */
let btFiles=[];
$('btPick').addEventListener('click',()=>$('btFile').click());
$('btFile').addEventListener('change',()=>{
  btFiles=btFiles.concat([...$('btFile').files]).slice(0,MAX_IMAGES);$('btFile').value='';
  $('btThumbs').innerHTML='';for(const f of btFiles){const im=document.createElement('img');im.alt='Listing photo';im.src=URL.createObjectURL(f);$('btThumbs').append(im)}
  $('btClr').classList.toggle('hide',!btFiles.length);
});
$('btClr').addEventListener('click',()=>{btFiles=[];$('btThumbs').innerHTML='';$('btClr').classList.add('hide')});
$('btGo').addEventListener('click',async()=>{
  if(!aiOn())return;
  const txt=$('btTxt').value.trim().slice(0,5000),price=num($('btPrice').value),from=$('btFrom').value.trim().slice(0,120),seller=$('btSeller').value.trim().slice(0,200),fig=$('btFig').value.trim().slice(0,160);
  if(!txt&&!btFiles.length&&price==null){$('btOut').innerHTML='<p>Add the listing text, a price or some photos first.</p>';return}
  const x=CAT.find(c=>c.n.toLowerCase()===fig.toLowerCase());const i=x?it(x.id):{};const v=x?valOf(x):null;
  const ctx=x?`Catalog entry: ${x.n}, released ${fd(x.d)} in Japan, sold as ${TYP[x.t]}. ${v!=null?'The user last logged its market value at $'+v+'.':'No market value logged.'}${i.msrp!=null?' Original retail about $'+i.msrp+'.':''}`:(fig?`The buyer says it is: ${fig}.`:'Figure not specified.');
  const prompt=`You help collectors spot warning signs of bootleg (counterfeit) Bandai S.H.Figuarts Dragon Ball figures in second-hand listings. Review the listing and ${btFiles.length?'the attached listing photos':'note that no photos were provided'}.
Look for things like: price far below typical market value, especially for web or event exclusives; new sealed stock of old releases shipping from mainland China or Hong Kong; many units available; only official stock photos; words like "no box", "OEM", "KO", "replica", "custom" or "unbranded"; blurry or off-colour box printing; missing Bandai/Tamashii Nations logos, legal text or the authenticity sticker; sloppy or glossy paint, wrong proportions, loose joints or missing accessories; and seller history.
Be calibrated: you can't verify authenticity from a listing. Describe warning signs and good signs, never accuse the seller of fraud, and say clearly when there isn't enough information.

${ctx}
Asking price: ${price!=null?'$'+price:'not given'}
Ships from: ${from||'not given'}
Seller info: ${seller||'not given'}
Listing text:
${txt||'(none)'}

Reply with only JSON:
{"risk":"low|medium|high","score":0-100,"summary":"one or two sentences","flags":[{"severity":"high|medium|low","title":"short","detail":"one sentence"}],"good_signs":["short"],"next_steps":["short, e.g. ask the seller for a photo of the box bottom"]}`;
  $('btOut').innerHTML='<p class="thinking">Inspecting the listing</p>';$('btGo').disabled=true;
  try{
    const r=await aiJson(prompt,btFiles);
    const risk=['low','medium','high'].includes(r&&r.risk)?r.risk:'medium';const sc=Math.max(0,Math.min(100,Math.round(Number(r&&r.score)||50)));
    const arr=a=>Array.isArray(a)?a.slice(0,8):[];
    $('btOut').innerHTML=`<div class="risk ${risk}"><b>${risk.toUpperCase()} RISK</b><div><div class="rbar"><i style="left:${sc}%"></i></div><p style="margin:8px 0 0">${esc(String((r&&r.summary)||'').slice(0,400))}</p></div></div>`+
      (arr(r.flags).length?`<p class="aih">RED FLAGS</p><ul class="flags">${arr(r.flags).map(f=>`<li class="${['high','medium','low'].includes(f&&f.severity)?f.severity:'medium'}"><b>${esc(String((f&&f.title)||'').slice(0,100))}</b><span>${esc(String((f&&f.detail)||'').slice(0,300))}</span></li>`).join('')}</ul>`:'<p class="aih">NO RED FLAGS SPOTTED</p>')+
      (arr(r.good_signs).length?`<p class="aih">GOOD SIGNS</p><ul class="flags">${arr(r.good_signs).map(g=>`<li class="good"><span>${esc(String(g).slice(0,200))}</span></li>`).join('')}</ul>`:'')+
      (arr(r.next_steps).length?`<p class="aih">BEFORE YOU BUY</p><ul class="flags">${arr(r.next_steps).map(g=>`<li class="low"><span>${esc(String(g).slice(0,200))}</span></li>`).join('')}</ul>`:'')+
      '<p class="note">This is an AI check of warning signs, not proof either way. When in doubt, buy from a trusted shop or a seller with a long history.</p>';
  }catch(e){$('btOut').innerHTML=`<p class="msg err">${esc(aiErr(e))}</p>`}
  finally{aiAvail()}
});

/* Ask your vault: Claude calls page tools that read the real collection */
let turns=[],askCtl=null;
const RULES=()=>`You are the assistant inside Capsule Vault, a Dragon Ball S.H.Figuarts collection tracker. Today is ${today()}. Answer the user's questions about their collection and the catalog. Always look the data up with the tools before answering; never invent figures, prices or counts. "Value" means the latest value the user logged in the app, not a live market price; if a price isn't logged, say so. Keep answers short (under 120 words), in plain text with no markdown headings, tables or bold; a few lines starting with "- " are fine. Use US dollars.`;
const row=x=>{const i=it(x.id),v=valOf(x),o={id:x.id,name:x.n,released:x.d,series:SER[x.s]||'Custom',sold_as:TYP[x.t],status:i.s||'none'};if(i.paid!=null)o.paid=i.paid;if(v!=null)o.value=v;if(i.target!=null)o.target=i.target;if(isDeal(x))o.deal=true;if(i.cond)o.condition=i.cond;if(x.d>NOW)o.upcoming=true;return o};
const AITOOLS=[
  {name:'find_figures',description:'Search the catalog together with the user\'s collection. Returns matching figures with status (own, want or none), paid, logged value, wishlist target and deal flag. Use it for any question about specific figures, characters, series, release types or prices.',
   inputSchema:{type:'object',properties:{text:{type:'string',description:'Words that must all appear in the figure name, e.g. "vegeta" or "super saiyan 3". Optional.'},status:{type:'string',enum:['own','want','none','any']},series:{type:'string',enum:Object.values(SER)},sold_as:{type:'string',enum:Object.values(TYP)},year_from:{type:'integer'},year_to:{type:'integer'},max_value:{type:'number',description:'Only figures whose logged value or wishlist target is at most this many dollars'},sort:{type:'string',enum:['value_desc','value_asc','gain_desc','newest','oldest','name']},limit:{type:'integer',description:'Default 25, max 50'}}},
   execute(a){
     const words=String(a.text||'').toLowerCase().split(/\s+/).filter(Boolean);
     let r=all().filter(x=>{const i=it(x.id),y=+String(x.d).slice(0,4);
       if(words.length&&!words.every(w=>x.n.toLowerCase().includes(w)))return false;
       const st=String(a.status||'any');if(st!=='any'&&(i.s||'none')!==st)return false;
       if(a.series&&SER[x.s]!==a.series)return false;if(a.sold_as&&TYP[x.t]!==a.sold_as)return false;
       if(a.year_from&&y<Number(a.year_from))return false;if(a.year_to&&y>Number(a.year_to))return false;
       if(a.max_value!=null){const e=valOf(x)??i.target;if(e==null||e>Number(a.max_value))return false}
       return true});
     const g=x=>{const v=valOf(x),p=it(x.id).paid;return v!=null&&p!=null?v-p:-1e12};
     const s=String(a.sort||'');
     if(s==='value_desc')r.sort((p,q)=>(valOf(q)??-1)-(valOf(p)??-1));else if(s==='value_asc')r.sort((p,q)=>(valOf(p)??1e12)-(valOf(q)??1e12));else if(s==='gain_desc')r.sort((p,q)=>g(q)-g(p));else if(s==='newest')r.sort((p,q)=>q.d.localeCompare(p.d));else if(s==='oldest')r.sort((p,q)=>p.d.localeCompare(q.d));else if(s==='name')r.sort((p,q)=>p.n.localeCompare(q.n));
     const lim=Math.max(1,Math.min(50,Number(a.limit)||25));
     return {total_matches:r.length,shown:Math.min(lim,r.length),figures:r.slice(0,lim).map(row)};
   }},
  {name:'collection_summary',description:'Totals for the user\'s collection: owned count, total paid, total logged value, gain, wishlist size, active deals, badges unlocked, and owned counts by series and by how they were sold.',
   execute(){
     const L=all(),o=L.filter(x=>it(x.id).s==='own');let paid=0,val=0;const bySeries={},byType={};
     for(const x of o){const i=it(x.id),v=valOf(x);paid+=i.paid||0;val+=v!=null?v:(i.paid||0);const s=SER[x.s]||'Custom';bySeries[s]=(bySeries[s]||0)+1;byType[TYP[x.t]]=(byType[TYP[x.t]]||0)+1}
     return {catalog_size:L.length,owned:o.length,total_paid:Math.round(paid),total_value:Math.round(val),gain:Math.round(val-paid),wishlist:L.filter(x=>it(x.id).s==='want').length,deals:L.filter(isDeal).length,badges_unlocked:achievements(L).filter(b=>b.got).length,owned_by_series:bySeries,owned_by_type:byType,note:'Figures without a logged value count at what was paid.'};
   }},
  {name:'character_progress',description:'For each main character, how many releases the user owns versus how many are in the catalog.',
   execute(){const cat=all().filter(x=>x.t!=='C');return CHARS.map(([n,f])=>{const a=cat.filter(x=>f(x.n));return {character:n,owned:a.filter(x=>it(x.id).s==='own').length,total:a.length}})}}
];
function bubble(cls,text){const d=document.createElement('div');d.className='msg '+cls;d.textContent=text;$('chat').append(d);$('chat').scrollTop=$('chat').scrollHeight;return d}
// The tool-use loop. Claude can't see the collection directly: it asks for
// data by "calling" a tool, this page runs the matching function and sends the
// result back, and Claude repeats until it has enough to answer.
const TOOL_DEFS=AITOOLS.map(t=>({name:t.name,description:t.description,input_schema:t.inputSchema||{type:'object',properties:{}}}));
async function ask(q){
  q=String(q||'').trim().slice(0,600);if(!q||!aiOn()||askCtl)return;
  $('askIn').value='';bubble('me',q);turns.push({role:'user',content:q});
  const out=bubble('ai thinking','Checking your vault');
  askCtl=new AbortController();const sig=askCtl.signal;$('askStop').classList.remove('hide');$('askGo').disabled=true;
  const msgs=turns.slice(-10).map(t=>({role:t.role,content:t.content}));
  if(msgs[0].role!=='user')msgs.shift();
  const trace=[];
  try{
    let answer='';
    for(let round=0;round<5;round++){
      const r=await callAI({tier:'fast',max_tokens:900,system:RULES(),tools:TOOL_DEFS,messages:msgs});
      if(sig.aborted)throw {code:'cancelled'};
      const content=Array.isArray(r&&r.content)?r.content:[];
      const uses=content.filter(b=>b.type==='tool_use');
      if(r.stop_reason!=='tool_use'||!uses.length){answer=textOf(r);break}
      msgs.push({role:'assistant',content});
      out.textContent='Looking up: '+uses.map(u=>u.name.replace(/_/g,' ')).join(', ');
      msgs.push({role:'user',content:uses.map(u=>{
        const tool=AITOOLS.find(t=>t.name===u.name);let res;
        try{if(!tool)throw new Error('Unknown tool');res=JSON.stringify(tool.execute(u.input||{}))}catch(e){res='Error: '+(e.message||e)}
        trace.push(u.name+'('+JSON.stringify(u.input||{})+')');
        return {type:'tool_result',tool_use_id:u.id,content:res.slice(0,30000)};
      })});
    }
    if(!answer)answer="I couldn't finish looking that up. Try asking a narrower question.";
    out.classList.remove('thinking');out.textContent=answer;turns.push({role:'assistant',content:answer});
    if(trace.length){const d=document.createElement('details');d.className='trace';const s=document.createElement('summary');s.textContent='How I answered ('+trace.length+' lookup'+(trace.length>1?'s':'')+')';const p=document.createElement('pre');p.textContent=trace.join('\n');d.append(s,p);out.append(d)}
  }catch(e){out.remove();turns.pop();if(!(e&&e.code==='cancelled'))bubble('ai err',aiErr(e))}
  finally{askCtl=null;$('askStop').classList.add('hide');$('askClr').classList.toggle('hide',!turns.length);aiAvail()}
}
$('askGo').addEventListener('click',()=>ask($('askIn').value));
$('askIn').addEventListener('keydown',e=>{if(e.key==='Enter')ask($('askIn').value)});
$('askChips').addEventListener('click',e=>{const b=e.target.closest('.chip');if(b)ask(b.textContent)});
$('askStop').addEventListener('click',()=>{if(askCtl)askCtl.abort()});
$('askClr').addEventListener('click',()=>{turns=[];$('chat').innerHTML='';$('askClr').classList.add('hide')});

// Every theme except Retro builds on the modern "classic" layout and only changes colours (and fonts for Kawaii).
const SKINS=['light','dark','namek','ocean','ember','kawaii'];
function setSkin(k){
  const r=document.documentElement;
  if(SKINS.includes(k)){r.dataset.skin=k;r.classList.add('classic')}else{delete r.dataset.skin;r.classList.remove('classic');k='retro'}
  $('skin').value=k;
  try{localStorage.setItem('capsule-vault-skin',k)}catch(e){}
  chart();
}
$('skin').value=document.documentElement.dataset.skin||'retro';
// The AI Lab stays hidden until the AI server function is deployed (see README).
if(!AI_ENABLED){const t=document.querySelector('[data-v="ai"]');if(t)t.remove()}
$('skin').addEventListener('change',()=>setSkin($('skin').value));

render();
route();

/* ---------- Accounts (Supabase Auth, email magic link) ---------- */
function authUI(email){
  $('authBtn').classList.toggle('hide',!sb);
  $('authBtn').textContent=myUid?'SIGN OUT':'SIGN IN';
  $('who').textContent=myUid&&email?email:'';
}
async function loadVault(){
  setSync('Loading your vault...');
  const {data,error}=await sb.from('vaults').select('data').eq('user_id',myUid).maybeSingle();
  if(error){setSync("Can't reach your account right now. Changes are saved on this device.");return}
  const remote=data&&data.data?norm(data.data):null;
  const remoteHas=remote&&(Object.keys(remote.items).length||remote.custom.length);
  const localHas=Object.keys(state.items).length||state.custom.length;
  if(remoteHas){state=remote;try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}dirty=false;render();if(cur)fill()}
  else if(localHas){await flush()}  // first sign-in: upload what was tracked on this device
  setSync('Synced to your account. Open it on any device.');
}
async function onAuth(session){
  const uid=session&&session.user?session.user.id:null,email=session&&session.user?session.user.email:'';
  if(uid===myUid){authUI(email);return}
  const wasSignedIn=!!myUid;
  myUid=uid;ref=uid?{uid}:null;assets=!!uid;
  authUI(email);
  aiAvail();if(view==='shelf')scPanel();if(cur)fill();
  if(!uid){
    if(wasSignedIn){state=fresh();try{localStorage.removeItem(KEY)}catch(e){}render()}  // don't leave a private vault on a shared device
    setSync(sb?'Saved on this device. Sign in to sync across devices.':'Saved on this device.');
    return;
  }
  await loadVault();
}
$('authBtn').addEventListener('click',async()=>{
  if(!sb)return;
  if(myUid){if(dirty)await flush();await sb.auth.signOut();return}
  $('aMsg').textContent='';$('auth').classList.add('show');setTimeout(()=>$('aEmail').focus(),30);
});
const closeAuth=()=>$('auth').classList.remove('show');
$('aX').addEventListener('click',closeAuth);
$('auth').addEventListener('click',e=>{if(e.target===$('auth'))closeAuth()});
async function sendLink(){
  const email=$('aEmail').value.trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){$('aMsg').textContent='Enter a valid email address.';return}
  $('aGo').disabled=true;$('aMsg').textContent='Sending...';
  const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:SITE}});
  $('aGo').disabled=false;
  $('aMsg').textContent=error?"Couldn't send the link: "+error.message:'Check your inbox for a sign-in link from Capsule Vault. You can close this window.';
}
$('aGo').addEventListener('click',sendLink);
$('aEmail').addEventListener('keydown',e=>{if(e.key==='Enter')sendLink()});

// When you come back to the tab, pull in changes made on your other devices.
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&myUid&&!dirty&&!writing)loadVault()});

aiAvail();authUI('');
if(sb){
  // Supabase recommends not awaiting other Supabase calls inside this callback, so hand off with setTimeout.
  sb.auth.onAuthStateChange((event,session)=>{setTimeout(()=>onAuth(session),0)});
}else{
  setSync('Saved on this device. Add your Supabase keys in js/config.js to turn on accounts and sync.');
}
