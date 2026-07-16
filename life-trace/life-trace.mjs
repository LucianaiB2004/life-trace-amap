#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve } from 'node:path';

const confidenceLabels = {
  confirmed: '史料明确',
  inferred: '现代位置推定',
  disputed: '存在争议',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(value.trim());
      value = '';
    } else {
      value += char;
    }
  }
  fields.push(value.trim());
  return fields;
}

function loadCsv(path, personName) {
  const lines = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV 至少需要表头和一行事件。');
  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const required = ['year', 'place', 'title', 'description', 'longitude', 'latitude'];
  const missing = required.filter((field) => !headers.includes(field));
  if (missing.length) throw new Error('CSV 缺少字段：' + missing.join(', '));
  const events = lines.slice(1).map((line, rowIndex) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    return {
      id: 'upload-' + (rowIndex + 1),
      year: row.year,
      place: row.place,
      modernPlace: row.place,
      title: row.title,
      description: row.description,
      phase: '个人经历',
      coordinates: [Number(row.longitude), Number(row.latitude)],
      confidence: 'confirmed',
      sources: [{ label: '用户上传 CSV 第 ' + (rowIndex + 2) + ' 行' }],
    };
  });
  return {
    person: {
      name: personName || '我的人生地图',
      years: events.length ? events[0].year + '—' + events.at(-1).year : '',
      title: '私人足迹',
      summary: '本地图仅使用用户主动上传的 CSV 内容生成，未联网搜索私人资料。',
    },
    coordinateSystem: 'GCJ-02',
    coordinateProvider: '用户上传坐标',
    events,
  };
}

function loadData(path, personName) {
  if (extname(path).toLowerCase() === '.csv') return loadCsv(path, personName);
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function validateData(data) {
  const errors = [];
  if (!data?.person?.name) errors.push('person.name 不能为空');
  if (!Array.isArray(data?.events) || data.events.length === 0) {
    errors.push('events 至少需要一条事件');
    return errors;
  }
  const ids = new Set();
  data.events.forEach((event, index) => {
    const label = 'events[' + index + ']';
    for (const field of ['id', 'year', 'place', 'title', 'description', 'phase']) {
      if (!event[field]) errors.push(label + '.' + field + ' 不能为空');
    }
    if (ids.has(event.id)) errors.push(label + '.id 重复：' + event.id);
    ids.add(event.id);
    if (!Array.isArray(event.coordinates) || event.coordinates.length !== 2 || !event.coordinates.every(Number.isFinite)) {
      errors.push(label + '.coordinates 缺失；请提供坐标或经允许后使用高德地理编码，不得伪造坐标');
    }
    if (!confidenceLabels[event.confidence]) errors.push(label + '.confidence 必须是 confirmed、inferred 或 disputed');
    if (!Array.isArray(event.sources) || event.sources.length === 0) {
      errors.push(label + '.sources 至少需要一个来源');
    } else if (event.sources.some((source) => !source?.label)) {
      errors.push(label + '.sources 每个来源都需要 label');
    }
  });
  return errors;
}

function assertValid(data) {
  const errors = validateData(data);
  if (errors.length) throw new Error('数据校验失败：\n- ' + errors.join('\n- '));
}

function renderSources(sources) {
  return sources.map((source) => {
    const label = escapeHtml(source.label);
    return source.url
      ? '<a href="' + escapeHtml(source.url) + '" target="_blank" rel="noreferrer">' + label + '</a>'
      : '<span>' + label + '</span>';
  }).join('');
}

function renderCards(events) {
  return events.map((event, index) => {
    const [longitude, latitude] = event.coordinates;
    const amapUrl = 'https://uri.amap.com/marker?position=' + longitude + ',' + latitude
      + '&name=' + encodeURIComponent(event.modernPlace || event.place)
      + '&src=life-trace&coordinate=gaode&callnative=0';
    return '<article class="timeline-card' + (index === 0 ? ' active' : '') + '" data-event-id="' + escapeHtml(event.id) + '" data-phase="' + escapeHtml(event.phase) + '">'
      + '<div class="card-top"><span class="year">' + escapeHtml(event.year) + '</span><span class="confidence ' + escapeHtml(event.confidence) + '">可信度 · ' + confidenceLabels[event.confidence] + '</span></div>'
      + '<div class="place">' + escapeHtml(event.place) + '<span>' + escapeHtml(event.modernPlace || '') + '</span></div>'
      + '<h3>' + escapeHtml(event.title) + '</h3>'
      + '<p>' + escapeHtml(event.description) + '</p>'
      + '<details><summary>史料来源</summary><div class="sources">' + renderSources(event.sources) + '</div></details>'
      + '<a class="amap-link" href="' + escapeHtml(amapUrl) + '" target="_blank" rel="noreferrer">在高德地图查看现代位置 ↗</a>'
      + '</article>';
  }).join('');
}

function renderHtml(data) {
  const embedded = JSON.stringify(data).replaceAll('<', '\\u003c');
  const phases = [...new Set(data.events.map((event) => event.phase))];
  const locations = new Set(data.events.map((event) => event.coordinates.join(','))).size;
  const filters = ['全部阶段', ...phases].map((phase, index) => (
    '<button class="filter' + (index === 0 ? ' active' : '') + '" data-phase="' + escapeHtml(phase) + '">' + escapeHtml(phase) + '</button>'
  )).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(data.person.name)}的动态人生足迹地图">
  <title>人生经纬 · ${escapeHtml(data.person.name)}</title>
  <style>
    :root{color-scheme:dark;--ink:#07101f;--panel:#0a1528;--paper:#dbe9f4;--muted:#8293a9;--gold:#ffc857;--red:#ff4f3d;--cyan:#5cd6ff;--line:rgba(148,180,210,.16)}
    *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#030913;color:var(--paper);font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif}button,select{font:inherit}
    body:before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at 30% 35%,rgba(26,91,128,.18),transparent 34%),radial-gradient(circle at 70% 5%,rgba(255,79,61,.08),transparent 30%);z-index:0}
    .shell{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1.9fr) minmax(360px,.82fr);height:100vh;overflow:hidden}
    .map-stage{position:relative;overflow:hidden;border-right:1px solid var(--line);background:linear-gradient(155deg,#071528 0%,#06101f 48%,#040b16 100%)}
    .map-stage:after{content:"";position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(87,170,209,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(87,170,209,.045) 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(to bottom,black,transparent 90%)}
    header{position:absolute;top:0;left:0;right:0;z-index:4;padding:32px 38px;display:flex;justify-content:space-between;gap:20px;align-items:flex-start;background:linear-gradient(to bottom,rgba(3,9,19,.92),transparent)}
    .eyebrow{color:var(--gold);font-size:12px;font-weight:700;letter-spacing:.28em;text-transform:uppercase}.title{margin:7px 0 2px;font-size:clamp(26px,3.1vw,54px);font-family:Georgia,"Songti SC",serif;letter-spacing:.04em}.subtitle{margin:0;color:#9fb0c4;font-size:14px}.amap-badge{white-space:nowrap;border:1px solid rgba(92,214,255,.32);background:rgba(4,21,35,.7);color:#9be7ff;border-radius:999px;padding:9px 13px;font-size:12px}
    .stats{position:absolute;left:38px;bottom:34px;z-index:5;display:flex;gap:12px}.stat{min-width:92px;padding:12px 14px;border:1px solid var(--line);background:rgba(4,12,24,.72);backdrop-filter:blur(12px)}.stat strong{display:block;color:var(--gold);font:700 22px Georgia,serif}.stat span{font-size:11px;color:var(--muted);letter-spacing:.08em}
    #amapMap{position:absolute;inset:0;z-index:1;background:#06101f}.amap-logo,.amap-copyright{opacity:.65}.map-vignette{position:absolute;inset:0;z-index:2;pointer-events:none;box-shadow:inset 0 0 110px 34px rgba(2,8,17,.72);background:linear-gradient(to bottom,rgba(3,9,19,.5),transparent 28%,transparent 72%,rgba(3,9,19,.48))}.map-status{position:absolute;top:132px;left:38px;z-index:5;max-width:420px;padding:10px 13px;border:1px solid rgba(92,214,255,.3);background:rgba(4,17,31,.86);color:#a8eaff;font-size:12px;backdrop-filter:blur(10px)}.map-status.error{border-color:rgba(255,79,61,.6);color:#ffaaa0}.life-marker{position:relative;width:18px;height:18px;border:2px solid #ffe9b2;border-radius:50%;background:#ff4f3d;box-shadow:0 0 0 6px rgba(255,79,61,.18),0 0 18px rgba(255,79,61,.8);cursor:pointer;transition:transform .2s,background .2s}.life-marker:hover,.life-marker.active{transform:scale(1.35);background:var(--gold);box-shadow:0 0 0 8px rgba(255,200,87,.2),0 0 22px rgba(255,200,87,.95)}.life-marker.muted{opacity:.2}.amap-info-content{min-width:210px;color:#102033}.amap-info-content strong{display:block;margin-bottom:5px;font-size:15px}.amap-info-content span{color:#c33;font-weight:700}.amap-info-content p{margin:7px 0 0;line-height:1.55;color:#506070;font-size:12px}
    .play-panel{position:absolute;right:32px;bottom:34px;z-index:5;display:flex;align-items:center;gap:10px;padding:9px;border:1px solid var(--line);background:rgba(4,12,24,.84);backdrop-filter:blur(12px)}.play{border:0;background:var(--gold);color:#161004;font-weight:800;padding:10px 16px;cursor:pointer}.play:hover{background:#ffda84}.speed{border:1px solid var(--line);background:#09172a;color:var(--paper);padding:9px}.now-year{min-width:56px;text-align:center;font:700 19px Georgia,serif;color:var(--red)}
    aside{height:100vh;overflow:auto;background:rgba(7,15,29,.96);scrollbar-width:thin;scrollbar-color:#263b53 transparent}.side-head{position:sticky;top:0;z-index:6;padding:26px 26px 19px;background:linear-gradient(to bottom,#081326 75%,rgba(8,19,38,.9));border-bottom:1px solid var(--line)}.side-head h2{margin:0 0 8px;font-size:19px}.summary{margin:0 0 14px;color:#98a9bd;font-size:13px;line-height:1.65}.filters{display:flex;gap:7px;overflow:auto;padding-bottom:3px}.filter{white-space:nowrap;border:1px solid var(--line);border-radius:999px;background:transparent;color:#9bb0c6;padding:6px 10px;font-size:11px;cursor:pointer}.filter.active{border-color:rgba(255,200,87,.5);background:rgba(255,200,87,.12);color:var(--gold)}
    .timeline{padding:20px 22px 60px}.timeline-card{position:relative;margin:0 0 15px;padding:19px 18px 17px 23px;border:1px solid var(--line);background:linear-gradient(145deg,rgba(14,31,53,.82),rgba(7,17,32,.78));cursor:pointer;transition:transform .24s,border-color .24s,opacity .24s}.timeline-card:before{content:"";position:absolute;left:-1px;top:17px;bottom:17px;width:3px;background:#314459}.timeline-card:hover{transform:translateX(-3px);border-color:rgba(92,214,255,.32)}.timeline-card.active{border-color:rgba(255,200,87,.56);box-shadow:0 12px 40px rgba(0,0,0,.2)}.timeline-card.active:before{background:var(--gold);box-shadow:0 0 14px var(--gold)}.timeline-card.hidden{display:none}.card-top{display:flex;justify-content:space-between;gap:10px;align-items:center}.year{font:700 23px Georgia,serif;color:var(--gold)}.confidence{font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(92,214,255,.09);color:#9adff4}.confidence.inferred{background:rgba(255,200,87,.1);color:#ffd987}.confidence.disputed{background:rgba(255,79,61,.12);color:#ff9a8e}.place{margin:8px 0 2px;color:var(--red);font-size:13px;font-weight:800}.place span{margin-left:8px;color:#71869d;font-size:10px;font-weight:500}.timeline-card h3{margin:6px 0 7px;font-size:17px}.timeline-card p{margin:0;color:#a7b7c8;line-height:1.7;font-size:12px}.timeline-card details{margin-top:12px;font-size:11px;color:#8ca1b7}.timeline-card summary{cursor:pointer;color:#bed0e0}.sources{display:flex;flex-direction:column;gap:5px;margin-top:7px}.sources a,.sources span,.amap-link{color:#75d7f4;text-decoration:none}.sources a:hover,.amap-link:hover{text-decoration:underline}.amap-link{display:inline-block;margin-top:12px;font-size:11px}
    .footnote{padding:0 24px 36px;color:#6f8298;font-size:11px;line-height:1.65}
    @media(max-width:900px){.shell{display:block;height:auto;overflow:visible}.map-stage{height:68vh;min-height:520px;border-right:0;border-bottom:1px solid var(--line)}aside{height:auto;overflow:visible}.side-head{position:relative}.stats{left:18px;bottom:16px}.play-panel{right:18px;bottom:16px}header{padding:22px 20px}.amap-badge{display:none}.map-status{top:104px;left:20px}}
    @media(max-width:560px){.map-stage{min-height:600px}.title{font-size:31px}.stats{flex-direction:column;gap:5px}.stat{min-width:74px;padding:7px 9px}.stat strong{font-size:16px}.play-panel{align-items:stretch;flex-direction:column}.timeline{padding:15px 12px 40px}.side-head{padding:22px 16px}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important;transition:none!important}}
  </style>
</head>
<body>
  <main class="shell">
    <section class="map-stage" aria-label="${escapeHtml(data.person.name)}足迹地图">
      <header>
        <div><div class="eyebrow">LifeTrace · 人生经纬</div><h1 class="title">${escapeHtml(data.person.title || data.person.name)}</h1><p class="subtitle">${escapeHtml(data.person.name)} ${escapeHtml(data.person.courtesyName ? '· 字' + data.person.courtesyName : '')} ${escapeHtml(data.person.years || '')}</p></div>
        <div class="amap-badge" id="amapBadge">正在连接高德地图 · ${escapeHtml(data.coordinateSystem || 'GCJ-02')}</div>
      </header>
      <div id="amapMap" role="application" aria-label="真实高德地图上的人生足迹"></div>
      <div class="map-vignette"></div>
      <div class="map-status" id="mapStatus">正在加载高德 JS API 2.0…</div>
      <div class="stats"><div class="stat"><strong>${data.events.length}</strong><span>人生事件</span></div><div class="stat"><strong>${locations}</strong><span>地点节点</span></div><div class="stat"><strong>${phases.length}</strong><span>人生阶段</span></div></div>
      <div class="play-panel"><button class="play" id="playButton">▶ 播放足迹</button><select class="speed" id="speed" aria-label="播放速度"><option value="0.65">0.6×</option><option value="1" selected>1×</option><option value="1.8">1.8×</option></select><span class="now-year" id="nowYear">${escapeHtml(data.events[0].year)}</span></div>
    </section>
    <aside>
      <div class="side-head"><h2>一生，如何成为一条路</h2><p class="summary">${escapeHtml(data.person.summary)}</p><div class="filters">${filters}</div></div>
      <div class="timeline">${renderCards(data.events)}</div>
      <div class="footnote">路线仅表达事件发生地点的时间关系。古代行政区与现代坐标并非一一对应；标为“现代位置推定”的节点只用于空间叙事。</div>
    </aside>
  </main>
  <script src="/__lifetrace_amap_config__.js"></script>
  <script>
    const DATA=${embedded};
    const CONFIG=window.__LIFETRACE_AMAP_CONFIG__;
    const mapElement=document.getElementById('amapMap');
    const mapStatus=document.getElementById('mapStatus');
    const amapBadge=document.getElementById('amapBadge');
    const playButton=document.getElementById('playButton');
    const nowYear=document.getElementById('nowYear');
    const cards=[...document.querySelectorAll('.timeline-card')];
    let map,infoWindow,markers=[],segments=[],current=0,playing=false,timer=null,phase='全部阶段';

    function setStatus(message,state){mapStatus.textContent=message;mapStatus.classList.toggle('error',state==='error');mapStatus.dataset.state=state;amapBadge.textContent=state==='ready'?'高德地图已连接 · '+(DATA.coordinateSystem||'GCJ-02'):message}
    function loadAmap(){return new Promise((resolve,reject)=>{if(!CONFIG||!CONFIG.key){reject(new Error('未收到 AMAP_KEY，请使用 life-trace.mjs serve 启动'));return}if(CONFIG.securityKey)window._AMapSecurityConfig={securityJsCode:CONFIG.securityKey};const script=document.createElement('script');script.src='https://webapi.amap.com/maps?v=2.0&key='+encodeURIComponent(CONFIG.key)+'&plugin=AMap.Scale,AMap.ToolBar';script.onload=()=>window.AMap?resolve(window.AMap):reject(new Error('高德 JS API 未创建 AMap 对象'));script.onerror=()=>reject(new Error('高德 JS API 加载失败，请检查网络、Key 类型和域名白名单'));document.head.append(script)})}
    function markerContent(item,index){const button=document.createElement('button');button.type='button';button.className='life-marker'+(index===0?' active':'');button.dataset.eventId=item.id;button.dataset.phase=item.phase;button.title=item.year+' · '+item.place+' · '+item.title;button.setAttribute('aria-label',button.title);return button}
    function infoContent(item){const box=document.createElement('div');box.className='amap-info-content';const title=document.createElement('strong');title.textContent=item.title;const meta=document.createElement('span');meta.textContent=item.year+' · '+item.place;const body=document.createElement('p');body.textContent=item.description;box.append(title,meta,body);return box}
    function lineVisible(index){return index<current&&(phase==='全部阶段'||DATA.events[index+1].phase===phase)}
    function syncMapState(focus){markers.forEach((marker,index)=>{const allowed=phase==='全部阶段'||DATA.events[index].phase===phase;allowed?marker.show():marker.hide();marker.getContent().classList.toggle('active',index===current)});segments.forEach((segment,index)=>lineVisible(index)?segment.show():segment.hide());if(focus&&map){map.panTo(DATA.events[current].coordinates);openInfo(current)}}
    function openInfo(index){if(!map||!infoWindow)return;infoWindow.setContent(infoContent(DATA.events[index]));infoWindow.open(map,DATA.events[index].coordinates)}
    function activate(index,scroll,focus){current=index;cards.forEach((card,i)=>card.classList.toggle('active',i===index));nowYear.textContent=DATA.events[index].year;syncMapState(focus);if(scroll)cards[index].scrollIntoView({behavior:'smooth',block:'center'})}
    function stop(){playing=false;clearTimeout(timer);playButton.textContent='▶ 播放足迹'}
    function step(){if(!playing)return;if(current>=DATA.events.length-1){stop();return}activate(current+1,true,true);const speed=Number(document.getElementById('speed').value);timer=setTimeout(step,1100/speed)}

    async function initAmap(){
      try{
        const AMap=await loadAmap();
        map=new AMap.Map('amapMap',{center:[110.2,32.7],zoom:4,zooms:[3,18],mapStyle:'amap://styles/darkblue',viewMode:'2D',resizeEnable:true});
        window.__LIFETRACE_MAP__=map;
        map.on('complete',()=>{mapElement.dataset.amapReady='true';window.__LIFETRACE_AMAP_READY__=true;setStatus('高德 JS API 2.0 已连接 · 可缩放拖动','ready')});
        infoWindow=new AMap.InfoWindow({offset:new AMap.Pixel(0,-18),closeWhenClickMap:true});
        segments=DATA.events.slice(1).map((item,index)=>{const segment=new AMap.Polyline({path:[DATA.events[index].coordinates,item.coordinates],strokeColor:index%2?'#ff4f3d':'#ffc857',strokeOpacity:.95,strokeWeight:5,showDir:true,lineJoin:'round',lineCap:'round',zIndex:60});segment.setMap(map);segment.hide();return segment});
        markers=DATA.events.map((item,index)=>{const marker=new AMap.Marker({position:item.coordinates,anchor:'center',content:markerContent(item,index),title:item.year+' · '+item.place,zIndex:100+index});marker.setMap(map);marker.on('click',()=>activate(index,true,true));return marker});
        map.addControl(new AMap.Scale());
        map.addControl(new AMap.ToolBar({position:{right:'20px',bottom:'145px'}}));
        map.setFitView(markers,false,[120,80,125,80],5);
        activate(0,false,false);
      }catch(error){mapElement.dataset.amapReady='false';window.__LIFETRACE_AMAP_READY__=false;setStatus(error.message,'error')}
    }

    cards.forEach((card,index)=>card.addEventListener('click',(event)=>{if(event.target.closest('a,summary'))return;activate(index,false,true)}));
    playButton.addEventListener('click',()=>{if(playing){stop();return}if(current>=DATA.events.length-1)activate(0,true,true);playing=true;playButton.textContent='Ⅱ 暂停';step()});
    document.querySelectorAll('.filter').forEach((button)=>button.addEventListener('click',()=>{phase=button.dataset.phase;document.querySelectorAll('.filter').forEach((item)=>item.classList.toggle('active',item===button));cards.forEach((card)=>card.classList.toggle('hidden',phase!=='全部阶段'&&card.dataset.phase!==phase));syncMapState(false);const visibleMarkers=markers.filter((marker,index)=>phase==='全部阶段'||DATA.events[index].phase===phase);if(map&&visibleMarkers.length)map.setFitView(visibleMarkers,false,[120,80,125,80],5)}));
    initAmap();
  </script>
</body>
</html>`;
}

async function geocode(address) {
  const key = process.env.AMAP_KEY || process.env.AMAP_WEB_KEY;
  if (!key) throw new Error('未配置 AMAP_KEY。请把高德 Web 服务 Key 放入环境变量。');
  const url = new URL('https://restapi.amap.com/v3/geocode/geo');
  url.searchParams.set('address', address);
  url.searchParams.set('key', key);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (result.status !== '1' || !result.geocodes?.length) throw new Error('高德地理编码失败：' + (result.info || '无结果'));
  const item = result.geocodes[0];
  const coordinates = item.location.split(',').map(Number);
  console.log(JSON.stringify({
    provider: '高德开放平台',
    address: item.formatted_address,
    coordinates,
    level: item.level,
  }, null, 2));
}

async function serveHtml(input, port) {
  const key = process.env.AMAP_KEY || process.env.AMAP_WEB_KEY;
  if (!key) throw new Error('未配置 AMAP_KEY。serve 需要高德 Web JS API Key。');
  const html = readFileSync(input, 'utf8');
  const config = JSON.stringify({
    key,
    securityKey: process.env.AMAP_SECURITY_KEY || '',
  }).replaceAll('<', '\\u003c');
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/__lifetrace_amap_config__.js') {
      response.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
      });
      response.end('window.__LIFETRACE_AMAP_CONFIG__=' + config + ';');
      return;
    }
    if (url.pathname === '/' || url.pathname === '/demo.html') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
      });
      response.end(html);
      return;
    }
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  console.log('人生经纬预览：http://127.0.0.1:' + address.port + '/demo.html');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ['-h', '--help', 'help'].includes(command)) {
    console.log('人生经纬 · LifeTrace\n\n用法：\n  node life-trace.mjs validate <data.json|data.csv>\n  node life-trace.mjs build <input> <output.html> [--person <name>]\n  node life-trace.mjs serve <demo.html> [--port 8766]\n  node life-trace.mjs geocode <address>');
    return;
  }
  if (command === 'geocode') {
    if (!args[0]) throw new Error('geocode 需要地址。');
    await geocode(args.join(' '));
    return;
  }
  if (command === 'serve') {
    if (!args[0]) throw new Error('serve 需要 HTML 文件。');
    const portIndex = args.indexOf('--port');
    const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8766;
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('serve --port 必须是 0 到 65535 的整数。');
    await serveHtml(resolve(args[0]), port);
    return;
  }
  const input = args[0];
  if (!input) throw new Error(command + ' 需要输入文件。');
  const personIndex = args.indexOf('--person');
  const personName = personIndex >= 0 ? args[personIndex + 1] : undefined;
  const data = loadData(resolve(input), personName);
  assertValid(data);
  if (command === 'validate') {
    console.log('验证通过：' + data.person.name + '，共 ' + data.events.length + ' 条事件。');
    return;
  }
  if (command === 'build') {
    const output = args[1];
    if (!output || output.startsWith('--')) throw new Error('build 需要输出 HTML 路径。');
    const target = resolve(output);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, renderHtml(data), 'utf8');
    console.log('已生成：' + target);
    return;
  }
  throw new Error('未知命令：' + command);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
