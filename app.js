const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const STORE_KEY = 'trippath_v1';
const ORS_KEY = 'trippath_ors_key';
const DAY_STYLES = ['#d9342b','#ef7d16','#249343','#2574d9','#5946c7','#8d3cc7','#d83f8c','#8a5838','#008a8a','#455a64','#b23a48','#496f2d'];

let state = loadState();
let currentTripId = state.currentTripId || null;
let currentDay = 1;
let map = null;
let mapLayers = [];
let mapSelectedDays = new Set();
let pickingLocation = false;
let pickerReturnView = 'scheduleView';
let mapBanner = null;
let recommendationCache = null;
let routeCache = new Map();
let searchAbort = null;

function loadState(){
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {trips:[], currentTripId:null}; }
  catch { return {trips:[], currentTripId:null}; }
}
function saveState(){ state.currentTripId=currentTripId; localStorage.setItem(STORE_KEY,JSON.stringify(state)); }
function uid(){ return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2); }
function getTrip(){ return state.trips.find(t=>t.id===currentTripId) || null; }
function daysCount(t){ if(!t) return 0; const a=new Date(t.start+'T00:00:00'),b=new Date(t.end+'T00:00:00'); return Math.max(1,Math.round((b-a)/86400000)+1); }
function formatDate(s){ if(!s) return ''; const d=new Date(s+'T00:00:00'); return `${d.getMonth()+1}/${d.getDate()}`; }
function dayDate(t,day){ const d=new Date(t.start+'T00:00:00'); d.setDate(d.getDate()+day-1); return `${d.getMonth()+1}/${d.getDate()}`; }
function toast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),1800); }
function esc(s=''){ return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function fmtDist(m){ if(m==null) return '—'; return m>=1000?`${(m/1000).toFixed(1)}km`:`${Math.round(m)}m`; }
function fmtDur(sec){ if(sec==null) return '—'; const min=Math.round(sec/60); if(min<60) return `${min}분`; return `${Math.floor(min/60)}시간 ${min%60}분`; }
function dayColor(day){ return DAY_STYLES[(day-1)%DAY_STYLES.length]; }

function setView(id){
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===id));
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===id));
  if(id==='mapView'){ setTimeout(()=>{ initMap(); renderMap(); map.invalidateSize(); },50); }
  if(id==='scheduleView') renderSchedule();
  if(id==='placesView') renderPlaces();
  if(id==='homeView') renderHome();
}

function renderAll(){ renderHeader(); renderHome(); renderSchedule(); renderPlaces(); renderDayControls(); if(map) renderMap(); }
function renderHeader(){ const t=getTrip(); $('#tripTitle').textContent=t?t.name:'새 여행'; }

function renderHome(){
  const t=getTrip();
  $('#tripDates').textContent=t?`${formatDate(t.start)} — ${formatDate(t.end)} · ${daysCount(t)}일`:'여행을 먼저 만들어 주세요';
  $('#heroTitle').innerHTML=t?`${esc(t.name)}<br/><span style="font-size:16px;font-weight:500;opacity:.8">${t.items.length}개 장소 저장됨</span>`:'걷는 동선을 눈으로 보고,<br/>더 짧은 길은 추천만.';
  $('#newTripBtn').textContent=t?'현재 여행 열기':'여행 만들기';
  const list=$('#tripList');
  if(!state.trips.length){ list.innerHTML='<div class="empty">아직 여행이 없습니다.</div>'; return; }
  list.innerHTML=state.trips.map(tr=>`<div class="card trip-card ${tr.id===currentTripId?'active':''}">
    <button data-trip="${tr.id}"><strong>${esc(tr.name)}</strong><div class="muted" style="margin-top:5px">${formatDate(tr.start)} — ${formatDate(tr.end)} · ${daysCount(tr)}일 · ${tr.items.length}곳</div></button><span class="chev">›</span>
  </div>`).join('');
  list.querySelectorAll('[data-trip]').forEach(b=>b.onclick=()=>{currentTripId=b.dataset.trip;currentDay=1;mapSelectedDays=new Set([1]);saveState();renderAll();toast('여행을 열었어요');});
}

function renderDayControls(){
  const t=getTrip(); const n=daysCount(t);
  ['#dayTabs','#mapDayFilters'].forEach(sel=>{
    const el=$(sel); if(!el) return;
    if(!t){el.innerHTML='';return;}
    if(sel==='#dayTabs'){
      el.innerHTML=Array.from({length:n},(_,i)=>`<button class="day-chip ${currentDay===i+1?'active':''}" style="--day-color:${dayColor(i+1)}" data-day="${i+1}">D${i+1} <span style="opacity:.72">${dayDate(t,i+1)}</span></button>`).join('');
      el.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{currentDay=+b.dataset.day;renderSchedule();renderDayControls();});
    } else {
      if(!mapSelectedDays.size && n) mapSelectedDays.add(currentDay);
      el.innerHTML=`<button class="day-chip all-chip ${mapSelectedDays.size===n?'active':''}" data-all="1">전체</button>`+Array.from({length:n},(_,i)=>`<button class="day-chip ${mapSelectedDays.has(i+1)?'active':''}" style="--day-color:${dayColor(i+1)}" data-mapday="${i+1}">D${i+1}</button>`).join('');
      el.querySelector('[data-all]').onclick=()=>{ if(mapSelectedDays.size===n) mapSelectedDays.clear(); else mapSelectedDays=new Set(Array.from({length:n},(_,i)=>i+1)); renderDayControls();renderMap(); };
      el.querySelectorAll('[data-mapday]').forEach(b=>b.onclick=()=>{const d=+b.dataset.mapday;mapSelectedDays.has(d)?mapSelectedDays.delete(d):mapSelectedDays.add(d);renderDayControls();renderMap();});
    }
  });
}

function orderedItems(t,day){ return t.items.filter(i=>i.day===day).sort((a,b)=>(a.order??0)-(b.order??0)); }
function renderSchedule(){
  renderDayControls(); const t=getTrip(); const list=$('#scheduleList'); const summary=$('#routeSummary');
  if(!t){list.innerHTML='<div class="empty">여행을 먼저 만들어 주세요.</div>';summary.classList.add('hidden');return;}
  const items=orderedItems(t,currentDay);
  if(!items.length){list.innerHTML='<div class="empty">이 Day에 장소가 없습니다.<br/>장소를 추가하고 지도에서 위치를 찍어보세요.</div>';summary.classList.add('hidden');return;}
  list.innerHTML=items.map((it,idx)=>`${idx?`<div class="walk-leg" id="leg-${idx}">↓ 경로 계산 전</div>`:''}<div class="timeline-item ${it.locked?'locked':''}"><span class="dot"></span><div class="item-card" data-id="${it.id}">
    <div class="item-top"><div><div class="item-title">${it.locked?`🔒 ${it.time||'시간'} · `:''}${esc(it.name)}</div><div class="badges"><span class="badge">${esc(it.category)}</span><span class="badge">${it.priority==='must'?'⭐ 꼭 감':it.priority==='maybe'?'시간 남으면':'가고 싶음'}</span>${!it.lat?'<span class="badge">위치 필요</span>':''}</div></div><button class="text-btn edit-btn">수정</button></div>
    ${it.note?`<div class="muted" style="margin-top:9px">${esc(it.note)}</div>`:''}
    <div class="move-row"><button class="up-btn">↑ 위로</button><button class="down-btn">↓ 아래로</button></div>
  </div></div>`).join('');
  list.querySelectorAll('.item-card').forEach(card=>{
    const id=card.dataset.id;
    card.querySelector('.edit-btn').onclick=()=>openItemDialog(id);
    card.querySelector('.up-btn').onclick=()=>moveItem(id,-1);
    card.querySelector('.down-btn').onclick=()=>moveItem(id,1);
  });
  renderDayRouteStats(items);
}

async function renderDayRouteStats(items){
  const summary=$('#routeSummary');
  if(items.some(x=>!x.lat)||items.length<2){summary.classList.add('hidden');return;}
  const key=localStorage.getItem(ORS_KEY);
  if(!key){summary.classList.remove('hidden');summary.innerHTML='실제 도보거리 계산 준비 완료 · <b>설정에서 무료 ORS API 키를 넣으면 활성화</b>';return;}
  try{
    const data=await getRoute(items.map(x=>[x.lng,x.lat]));
    summary.classList.remove('hidden');summary.innerHTML=`현재 순서 · 도보 <b>${fmtDist(data.distance)}</b> · 약 <b>${fmtDur(data.duration)}</b>`;
    if(data.segments){ data.segments.forEach((s,i)=>{const el=$(`#leg-${i+1}`); if(el) el.textContent=`↓ 도보 ${fmtDist(s.distance)} · ${fmtDur(s.duration)}`;}); }
  }catch(e){summary.classList.remove('hidden');summary.textContent='도보 경로를 불러오지 못했어요. API 키나 네트워크를 확인해 주세요.';}
}

function moveItem(id,dir){
  const t=getTrip(); const items=orderedItems(t,currentDay); const idx=items.findIndex(x=>x.id===id); const j=idx+dir; if(j<0||j>=items.length)return;
  const a=items[idx],b=items[j]; const tmp=a.order;a.order=b.order;b.order=tmp;normalizeOrders(t,currentDay);saveState();renderSchedule();if(map)renderMap();
}
function normalizeOrders(t,day){ orderedItems(t,day).forEach((x,i)=>x.order=i); }

function renderPlaces(){
  const t=getTrip(); const list=$('#placeList');
  if(!t){list.innerHTML='<div class="empty">여행을 먼저 만들어 주세요.</div>';return;}
  const items=[...t.items].sort((a,b)=>a.day-b.day||(a.order??0)-(b.order??0));
  if(!items.length){list.innerHTML='<div class="empty">저장한 장소가 없습니다.</div>';return;}
  list.innerHTML=items.map(i=>`<div class="card place-card" data-id="${i.id}"><div class="row"><div><strong>${esc(i.name)}</strong><div class="meta">Day ${i.day} · ${esc(i.category)}${i.locked?` · 🔒 ${i.time||'고정'}`:''}</div></div><button class="text-btn">수정</button></div></div>`).join('');
  list.querySelectorAll('.place-card').forEach(c=>c.querySelector('button').onclick=()=>openItemDialog(c.dataset.id));
}

function initMap(){
  if(map) return;
  map=L.map('map',{zoomControl:false,touchZoom:true,doubleClickZoom:true,scrollWheelZoom:true}).setView([22.3193,114.1694],12);
  L.control.zoom({position:'bottomright'}).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{
    subdomains:'abcd',maxZoom:20,
    attribution:'&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(map);
  map.on('click',e=>{
    if(!pickingLocation) return;
    $('#itemLat').value=e.latlng.lat.toFixed(6); $('#itemLng').value=e.latlng.lng.toFixed(6); $('#itemLocationLabel').value=''; updateCoordText();
    pickingLocation=false; removePickerBanner(); $('#itemDialog').showModal(); setView(pickerReturnView); toast('위치를 선택했어요');
  });
}
function clearMapLayers(){mapLayers.forEach(l=>map.removeLayer(l));mapLayers=[];}
function makeDayIcon(day,index,locked=false){
  const color=dayColor(day);
  return L.divIcon({
    className:'day-pin-wrap',
    html:`<div class="day-pin" style="--day-color:${color}">${locked?'🔒 ':''}D${day}-${index}</div>`,
    iconSize:[48,28],iconAnchor:[24,14],popupAnchor:[0,-15]
  });
}
async function renderMap(){
  if(!map) return; clearMapLayers(); const t=getTrip(); if(!t){$('#mapLegend').textContent='여행을 먼저 만들어 주세요.';return;}
  const days=[...mapSelectedDays].sort((a,b)=>a-b); const all=[]; const status=[];
  for(const d of days){
    const items=orderedItems(t,d).filter(i=>i.lat);
    items.forEach((it,idx)=>{
      const m=L.marker([it.lat,it.lng],{icon:makeDayIcon(d,idx+1,it.locked)}).addTo(map)
        .bindPopup(`<b>${esc(it.name)}</b><br/>Day ${d}${it.locked?` · 🔒 ${it.time||''}`:''}`);
      mapLayers.push(m); all.push([it.lat,it.lng]);
    });
    if(items.length>=2){
      const key=localStorage.getItem(ORS_KEY);
      if(key){
        try{
          const r=await getRoute(items.map(i=>[i.lng,i.lat]));
          const outline=L.geoJSON(r.geometry,{style:{color:'#111',weight:9,opacity:.82,lineCap:'round',lineJoin:'round'}}).addTo(map);
          const line=L.geoJSON(r.geometry,{style:{color:dayColor(d),weight:5,opacity:.96,lineCap:'round',lineJoin:'round'}}).addTo(map);
          mapLayers.push(outline,line); status.push({day:d,text:'실제 도보경로'});
        }catch{
          status.push({day:d,text:'경로 불러오기 실패'});
        }
      }else{
        status.push({day:d,text:'도보경로 키 필요'});
      }
    }else if(items.length===1){ status.push({day:d,text:'장소 1곳'}); }
  }
  if(all.length) map.fitBounds(all,{padding:[34,34],maxZoom:15});
  $('#mapLegend').innerHTML=days.length?status.map(x=>`<span class="legend-item"><i style="--day-color:${dayColor(x.day)}"></i><b>D${x.day}</b> ${x.text}</span>`).join(''):'표시할 Day를 선택하세요.';
}

async function getRoute(coords){
  const apiKey=localStorage.getItem(ORS_KEY); if(!apiKey) throw new Error('NO_KEY');
  const ck='route:'+JSON.stringify(coords); if(routeCache.has(ck)) return routeCache.get(ck);
  const res=await fetch('https://api.openrouteservice.org/v2/directions/foot-walking/geojson',{method:'POST',headers:{'Authorization':apiKey,'Content-Type':'application/json'},body:JSON.stringify({coordinates:coords})});
  if(!res.ok) throw new Error('ROUTE_'+res.status);
  const gj=await res.json(); const f=gj.features[0]; const out={geometry:f.geometry,distance:f.properties.summary.distance,duration:f.properties.summary.duration,segments:f.properties.segments}; routeCache.set(ck,out); return out;
}
async function getMatrix(items){
  const apiKey=localStorage.getItem(ORS_KEY); if(!apiKey) throw new Error('NO_KEY');
  const res=await fetch('https://api.openrouteservice.org/v2/matrix/foot-walking',{method:'POST',headers:{'Authorization':apiKey,'Content-Type':'application/json'},body:JSON.stringify({locations:items.map(i=>[i.lng,i.lat]),metrics:['distance','duration'],units:'m'})});
  if(!res.ok) throw new Error('MATRIX_'+res.status); return await res.json();
}

async function searchPlaces(){
  const q=$('#itemName').value.trim();
  const key=localStorage.getItem(ORS_KEY);
  if(!q) return toast('장소명을 입력해 주세요');
  if(!key) return toast('장소 검색에는 설정의 무료 ORS API 키가 필요해요');
  if(searchAbort) searchAbort.abort();
  searchAbort=new AbortController();
  const status=$('#placeSearchStatus'),results=$('#placeSearchResults'),btn=$('#searchPlaceBtn');
  status.classList.remove('hidden'); results.classList.add('hidden'); status.textContent='장소 찾는 중…'; btn.disabled=true;
  try{
    const url=`https://api.openrouteservice.org/geocode/search?api_key=${encodeURIComponent(key)}&text=${encodeURIComponent(q)}&size=6`;
    const res=await fetch(url,{signal:searchAbort.signal});
    if(!res.ok) throw new Error('GEOCODE_'+res.status);
    const data=await res.json(); const features=data.features||[];
    if(!features.length){ status.textContent='검색 결과가 없어요. 도시명이나 국가명을 같이 입력해 보세요.'; results.innerHTML=''; return; }
    status.textContent='원하는 장소를 선택하세요.'; results.classList.remove('hidden');
    results.innerHTML=features.map((f,i)=>{
      const p=f.properties||{}; const label=p.label||p.name||'장소';
      const name=p.name||label.split(',')[0];
      const [lng,lat]=f.geometry.coordinates;
      return `<button type="button" class="search-result" data-i="${i}" data-lat="${lat}" data-lng="${lng}" data-name="${esc(name)}" data-label="${esc(label)}"><strong>${esc(name)}</strong><span>${esc(label)}</span></button>`;
    }).join('');
    results.querySelectorAll('.search-result').forEach(b=>b.onclick=()=>{
      $('#itemName').value=b.dataset.name;
      $('#itemLat').value=Number(b.dataset.lat).toFixed(6);
      $('#itemLng').value=Number(b.dataset.lng).toFixed(6);
      $('#itemLocationLabel').value=b.dataset.label;
      updateCoordText();
      results.classList.add('hidden'); status.textContent=`선택됨 · ${b.dataset.label}`;
      toast('지도 위치를 자동으로 잡았어요');
    });
  }catch(e){ if(e.name!=='AbortError') status.textContent='장소 검색에 실패했어요. API 키나 네트워크를 확인해 주세요.'; }
  finally{btn.disabled=false;}
}

async function optimizeCurrentDay(){
  const t=getTrip(); if(!t) return toast('여행을 먼저 만들어 주세요');
  const items=orderedItems(t,currentDay); if(items.length<3) return toast('장소가 3개 이상일 때 비교할 수 있어요');
  if(items.some(i=>!i.lat)) return toast('모든 장소의 위치를 먼저 찍어 주세요');
  if(!localStorage.getItem(ORS_KEY)){ $('#settingsDialog').showModal(); return toast('무료 ORS API 키를 먼저 넣어 주세요'); }
  $('#optimizeBtn').disabled=true; $('#optimizeBtn').textContent='계산 중…';
  try{
    const matrix=await getMatrix(items); const durations=matrix.durations, distances=matrix.distances;
    const blocks=splitByLocks(items); let suggested=[...items];
    for(const block of blocks){
      if(block.freeIndices.length<2) continue;
      const order=bestBlockOrder(block,items,durations);
      order.forEach((globalIdx,k)=>{ suggested[block.startSlot+k]=items[globalIdx]; });
    }
    const origIdx=items.map((_,i)=>i); const sugIdx=suggested.map(x=>items.findIndex(y=>y.id===x.id));
    const orig=pathCost(origIdx,durations,distances); const sug=pathCost(sugIdx,durations,distances);
    recommendationCache={suggested,orig,sug}; showRecommendation(items,suggested,orig,sug);
  }catch(e){toast('동선 계산에 실패했어요. API 키를 확인해 주세요.');}
  finally{$('#optimizeBtn').disabled=false;$('#optimizeBtn').textContent='✨ 더 짧은 동선 찾기';}
}
function splitByLocks(items){
  const lockIdx=items.map((x,i)=>x.locked?i:-1).filter(i=>i>=0); const blocks=[];
  let start=0;
  for(const li of [...lockIdx,items.length]){
    const free=[]; for(let i=start;i<li;i++) if(!items[i].locked) free.push(i);
    if(free.length) blocks.push({freeIndices:free,startAnchor:start-1>=0&&items[start-1].locked?start-1:null,endAnchor:li<items.length&&items[li].locked?li:null,startSlot:start});
    start=li+1;
  }
  return blocks;
}
function bestBlockOrder(block,items,dur){
  const free=block.freeIndices;
  if(free.length<=8){
    let best=null,bestCost=Infinity;
    for(const perm of permutations(free)){
      let seq=[]; if(block.startAnchor!=null)seq.push(block.startAnchor); seq.push(...perm); if(block.endAnchor!=null)seq.push(block.endAnchor);
      const c=pathCost(seq,dur,null).duration; if(c<bestCost){bestCost=c;best=perm;}
    }
    return best;
  }
  const starts=block.startAnchor!=null?[null]:free;
  let best=null,bestCost=Infinity;
  for(const st of starts){
    const left=new Set(free); const order=[]; let cur=block.startAnchor;
    if(st!=null){order.push(st);left.delete(st);cur=st;}
    while(left.size){let nxt=[...left][0],v=Infinity;for(const j of left){const c=cur==null?0:dur[cur][j];if(c<v){v=c;nxt=j;}}order.push(nxt);left.delete(nxt);cur=nxt;}
    const seq=[];if(block.startAnchor!=null)seq.push(block.startAnchor);seq.push(...order);if(block.endAnchor!=null)seq.push(block.endAnchor);
    const c=pathCost(seq,dur,null).duration;if(c<bestCost){bestCost=c;best=order;}
  }
  return best;
}
function* permutations(arr){ if(arr.length<=1){yield arr.slice();return;} for(let i=0;i<arr.length;i++){const rest=arr.slice(0,i).concat(arr.slice(i+1));for(const p of permutations(rest))yield [arr[i],...p];} }
function pathCost(indices,dur,dist){let duration=0,distance=0;for(let i=1;i<indices.length;i++){duration+=dur[indices[i-1]][indices[i]]||0;if(dist)distance+=dist[indices[i-1]][indices[i]]||0;}return{duration,distance};}
function showRecommendation(origItems,suggested,orig,sug){
  const changed=origItems.some((x,i)=>x.id!==suggested[i].id); const saveSec=Math.max(0,orig.duration-sug.duration); const saveM=Math.max(0,orig.distance-sug.distance);
  $('#recommendBody').innerHTML=`<div class="recommend-block"><div class="muted">현재 순서</div><div class="arrow-list">${origItems.map(x=>esc(x.name)).join(' → ')}</div><div class="compare"><div>도보거리<br/><b>${fmtDist(orig.distance)}</b></div><div>도보시간<br/><b>${fmtDur(orig.duration)}</b></div></div></div>
  <div class="recommend-block"><div class="muted">추천 순서</div><div class="arrow-list"><b>${suggested.map(x=>x.locked?`🔒 ${esc(x.name)}`:esc(x.name)).join(' → ')}</b></div><div class="compare"><div>도보거리<br/><b>${fmtDist(sug.distance)}</b></div><div>도보시간<br/><b>${fmtDur(sug.duration)}</b></div></div>${changed&&saveSec>0?`<div class="info-box">약 <b>${fmtDist(saveM)}</b> · <b>${fmtDur(saveSec)}</b> 절약 가능. 원래 일정은 아직 바뀌지 않았어요.</div>`:'<div class="info-box">현재 순서가 이미 가장 짧거나 차이가 거의 없어요.</div>'}</div>
  ${changed&&saveSec>0?'<button class="primary full" id="applyRecommendBtn">이 추천 순서로 변경</button>':''}<button class="ghost full" id="ignoreRecommendBtn">그대로 둘게</button>`;
  $('#recommendDialog').showModal();
  const apply=$('#applyRecommendBtn'); if(apply) apply.onclick=applyRecommendation;
  $('#ignoreRecommendBtn').onclick=()=>$('#recommendDialog').close();
}
function applyRecommendation(){
  if(!recommendationCache)return; const t=getTrip(); recommendationCache.suggested.forEach((x,i)=>{const real=t.items.find(y=>y.id===x.id);real.order=i;});saveState();$('#recommendDialog').close();recommendationCache=null;renderSchedule();if(map)renderMap();toast('추천 순서를 적용했어요');
}

function openTripDialog(){
  const now=new Date(); const d1=now.toISOString().slice(0,10); const d2=new Date(now.getTime()+3*86400000).toISOString().slice(0,10); $('#tripName').value='';$('#tripStart').value=d1;$('#tripEnd').value=d2;$('#tripDialog').showModal();
}
function openItemDialog(id=null){
  const t=getTrip(); if(!t)return toast('여행을 먼저 만들어 주세요'); const n=daysCount(t); $('#itemDay').innerHTML=Array.from({length:n},(_,i)=>`<option value="${i+1}">Day ${i+1} · ${dayDate(t,i+1)}</option>`).join('');
  const it=id?t.items.find(x=>x.id===id):null; $('#itemId').value=it?.id||'';$('#itemName').value=it?.name||'';$('#itemDay').value=it?.day||currentDay;$('#itemCategory').value=it?.category||'관광';$('#itemLocked').checked=!!it?.locked;$('#itemTime').value=it?.time||'';$('#itemPriority').value=it?.priority||'want';$('#itemNote').value=it?.note||'';$('#itemLat').value=it?.lat||'';$('#itemLng').value=it?.lng||'';$('#itemLocationLabel').value=it?.locationLabel||'';$('#itemDialogTitle').textContent=it?'장소 수정':'장소 추가';$('#deleteItemBtn').classList.toggle('hidden',!it);$('#placeSearchResults').classList.add('hidden');$('#placeSearchResults').innerHTML='';$('#placeSearchStatus').classList.add('hidden');$('#placeSearchStatus').textContent='';updateTimeField();updateCoordText();$('#itemDialog').showModal();
}
function updateTimeField(){ $('#timeField').classList.toggle('hidden',!$('#itemLocked').checked); }
function updateCoordText(){ const lat=$('#itemLat').value,lng=$('#itemLng').value,label=$('#itemLocationLabel').value;$('#coordText').textContent=lat&&lng?(label?`${label} · ${(+lat).toFixed(5)}, ${(+lng).toFixed(5)}`:`${(+lat).toFixed(5)}, ${(+lng).toFixed(5)}`):'장소를 검색하거나 지도에서 위치를 찍어 주세요.'; }
function startPickLocation(){
  pickerReturnView=$('.view.active')?.id||'scheduleView'; $('#itemDialog').close(); setView('mapView'); initMap(); pickingLocation=true;
  if($('#itemLat').value&&$('#itemLng').value)map.setView([+$('#itemLat').value,+$('#itemLng').value],16);
  showPickerBanner();
}
function showPickerBanner(){removePickerBanner();mapBanner=document.createElement('div');mapBanner.className='picker-banner';mapBanner.textContent='지도에서 장소 위치를 한 번 눌러 주세요.';$('#map').appendChild(mapBanner)}
function removePickerBanner(){if(mapBanner){mapBanner.remove();mapBanner=null;}}

function saveTripFromForm(e){
  e.preventDefault(); const name=$('#tripName').value.trim(),start=$('#tripStart').value,end=$('#tripEnd').value;if(!name||!start||!end)return;if(end<start)return toast('종료일은 출발일보다 뒤여야 해요');const trip={id:uid(),name,start,end,items:[]};state.trips.push(trip);currentTripId=trip.id;currentDay=1;mapSelectedDays=new Set([1]);saveState();$('#tripDialog').close();renderAll();toast('여행을 만들었어요');
}
function saveItemFromForm(e){
  e.preventDefault(); const t=getTrip(); const id=$('#itemId').value; const day=+$('#itemDay').value; const data={name:$('#itemName').value.trim(),day,category:$('#itemCategory').value,locked:$('#itemLocked').checked,time:$('#itemLocked').checked?$('#itemTime').value:'',priority:$('#itemPriority').value,note:$('#itemNote').value.trim(),locationLabel:$('#itemLocationLabel').value.trim(),lat:$('#itemLat').value?+$('#itemLat').value:null,lng:$('#itemLng').value?+$('#itemLng').value:null};if(!data.name)return;
  if(id){Object.assign(t.items.find(x=>x.id===id),data);}else{const max=Math.max(-1,...t.items.filter(x=>x.day===day).map(x=>x.order??0));t.items.push({id:uid(),order:max+1,...data});}
  for(let d=1;d<=daysCount(t);d++)normalizeOrders(t,d);routeCache.clear();saveState();$('#itemDialog').close();renderAll();toast('저장했어요');
}
function deleteItem(){const t=getTrip(),id=$('#itemId').value;if(!id)return;t.items=t.items.filter(x=>x.id!==id);for(let d=1;d<=daysCount(t);d++)normalizeOrders(t,d);saveState();$('#itemDialog').close();renderAll();toast('삭제했어요');}

$$('.nav-item').forEach(b=>b.onclick=()=>setView(b.dataset.view));
$('#newTripBtn').onclick=()=>getTrip()?setView('scheduleView'):openTripDialog();$('#addTripBtn').onclick=openTripDialog;
$('#tripForm').addEventListener('submit',saveTripFromForm);$('#itemForm').addEventListener('submit',saveItemFromForm);
$('#addItemBtn').onclick=()=>openItemDialog();$('#placesAddBtn').onclick=()=>openItemDialog();$('#mapAddBtn').onclick=()=>openItemDialog();
$('#itemLocked').onchange=updateTimeField;$('#pickLocationBtn').onclick=startPickLocation;$('#searchPlaceBtn').onclick=searchPlaces;$('#itemName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchPlaces();}});$('#deleteItemBtn').onclick=deleteItem;
$('#settingsBtn').onclick=()=>{$('#orsKey').value=localStorage.getItem(ORS_KEY)||'';$('#settingsDialog').showModal();};
$('#settingsForm').addEventListener('submit',e=>{e.preventDefault();localStorage.setItem(ORS_KEY,$('#orsKey').value.trim());routeCache.clear();$('#settingsDialog').close();renderAll();toast('설정을 저장했어요');});
$('#clearAllBtn').onclick=()=>{localStorage.removeItem(STORE_KEY);localStorage.removeItem(ORS_KEY);state={trips:[],currentTripId:null};currentTripId=null;currentDay=1;mapSelectedDays.clear();routeCache.clear();$('#settingsDialog').close();renderAll();toast('모든 데이터를 지웠어요');};
$('#optimizeBtn').onclick=optimizeCurrentDay;$('#fitDayBtn').onclick=()=>{mapSelectedDays=new Set([currentDay]);setView('mapView');renderDayControls();renderMap();};
$('#closeRecommendBtn').onclick=()=>$('#recommendDialog').close();

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
renderAll();

// v2.1: close sheet buttons without submitting/validating their forms
document.querySelectorAll('[data-close-dialog]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const dlg=document.getElementById(btn.dataset.closeDialog);
    if(dlg?.open) dlg.close();
  });
});
