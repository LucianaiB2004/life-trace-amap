#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    #mapSvg{position:absolute;inset:78px 0 32px;width:100%;height:calc(100% - 110px);z-index:2;overflow:visible}.china-shape{fill:url(#landGradient);stroke:rgba(128,196,226,.25);stroke-width:2}.province-line{fill:none;stroke:rgba(135,181,207,.12);stroke-width:1}.route-shadow{fill:none;stroke:rgba(255,79,61,.2);stroke-width:11;stroke-linecap:round}.route-segment{fill:none;stroke:url(#routeGradient);stroke-width:4;stroke-linecap:round;filter:url(#glow);opacity:.16;transition:opacity .45s,stroke-dashoffset .9s ease}.route-segment.revealed{opacity:1;stroke-dashoffset:0!important}.node{cursor:pointer;transition:opacity .25s}.node .halo{fill:rgba(255,79,61,.15);stroke:rgba(255,200,87,.45);stroke-width:1}.node .core{fill:#ff4f3d;stroke:#ffe9b2;stroke-width:2}.node.active .halo{animation:pulse 1.4s ease-out infinite;fill:rgba(255,200,87,.24)}.node.active .core{fill:var(--gold)}.node-label{fill:#dbe9f4;font-size:15px;font-weight:700;paint-order:stroke;stroke:#06101f;stroke-width:5px;stroke-linejoin:round}.node-year{fill:#ffc857;font-size:12px;font-family:Georgia,serif;paint-order:stroke;stroke:#06101f;stroke-width:4px}@keyframes pulse{to{r:23;opacity:0}}
    .play-panel{position:absolute;right:32px;bottom:34px;z-index:5;display:flex;align-items:center;gap:10px;padding:9px;border:1px solid var(--line);background:rgba(4,12,24,.84);backdrop-filter:blur(12px)}.play{border:0;background:var(--gold);color:#161004;font-weight:800;padding:10px 16px;cursor:pointer}.play:hover{background:#ffda84}.speed{border:1px solid var(--line);background:#09172a;color:var(--paper);padding:9px}.now-year{min-width:56px;text-align:center;font:700 19px Georgia,serif;color:var(--red)}
    aside{height:100vh;overflow:auto;background:rgba(7,15,29,.96);scrollbar-width:thin;scrollbar-color:#263b53 transparent}.side-head{position:sticky;top:0;z-index:6;padding:26px 26px 19px;background:linear-gradient(to bottom,#081326 75%,rgba(8,19,38,.9));border-bottom:1px solid var(--line)}.side-head h2{margin:0 0 8px;font-size:19px}.summary{margin:0 0 14px;color:#98a9bd;font-size:13px;line-height:1.65}.filters{display:flex;gap:7px;overflow:auto;padding-bottom:3px}.filter{white-space:nowrap;border:1px solid var(--line);border-radius:999px;background:transparent;color:#9bb0c6;padding:6px 10px;font-size:11px;cursor:pointer}.filter.active{border-color:rgba(255,200,87,.5);background:rgba(255,200,87,.12);color:var(--gold)}
    .timeline{padding:20px 22px 60px}.timeline-card{position:relative;margin:0 0 15px;padding:19px 18px 17px 23px;border:1px solid var(--line);background:linear-gradient(145deg,rgba(14,31,53,.82),rgba(7,17,32,.78));cursor:pointer;transition:transform .24s,border-color .24s,opacity .24s}.timeline-card:before{content:"";position:absolute;left:-1px;top:17px;bottom:17px;width:3px;background:#314459}.timeline-card:hover{transform:translateX(-3px);border-color:rgba(92,214,255,.32)}.timeline-card.active{border-color:rgba(255,200,87,.56);box-shadow:0 12px 40px rgba(0,0,0,.2)}.timeline-card.active:before{background:var(--gold);box-shadow:0 0 14px var(--gold)}.timeline-card.hidden{display:none}.card-top{display:flex;justify-content:space-between;gap:10px;align-items:center}.year{font:700 23px Georgia,serif;color:var(--gold)}.confidence{font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(92,214,255,.09);color:#9adff4}.confidence.inferred{background:rgba(255,200,87,.1);color:#ffd987}.confidence.disputed{background:rgba(255,79,61,.12);color:#ff9a8e}.place{margin:8px 0 2px;color:var(--red);font-size:13px;font-weight:800}.place span{margin-left:8px;color:#71869d;font-size:10px;font-weight:500}.timeline-card h3{margin:6px 0 7px;font-size:17px}.timeline-card p{margin:0;color:#a7b7c8;line-height:1.7;font-size:12px}.timeline-card details{margin-top:12px;font-size:11px;color:#8ca1b7}.timeline-card summary{cursor:pointer;color:#bed0e0}.sources{display:flex;flex-direction:column;gap:5px;margin-top:7px}.sources a,.sources span,.amap-link{color:#75d7f4;text-decoration:none}.sources a:hover,.amap-link:hover{text-decoration:underline}.amap-link{display:inline-block;margin-top:12px;font-size:11px}
    .footnote{padding:0 24px 36px;color:#6f8298;font-size:11px;line-height:1.65}
    @media(max-width:900px){.shell{display:block;height:auto;overflow:visible}.map-stage{height:68vh;min-height:520px;border-right:0;border-bottom:1px solid var(--line)}aside{height:auto;overflow:visible}.side-head{position:relative}.stats{left:18px;bottom:16px}.play-panel{right:18px;bottom:16px}header{padding:22px 20px}.amap-badge{display:none}#mapSvg{inset:70px 0 50px;height:calc(100% - 120px)}}
    @media(max-width:560px){.map-stage{min-height:600px}.title{font-size:31px}.stats{flex-direction:column;gap:5px}.stat{min-width:74px;padding:7px 9px}.stat strong{font-size:16px}.play-panel{align-items:stretch;flex-direction:column}.timeline{padding:15px 12px 40px}.side-head{padding:22px 16px}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important;transition:none!important}.route-segment{stroke-dashoffset:0!important}}
  </style>
</head>
<body>
  <main class="shell">
    <section class="map-stage" aria-label="${escapeHtml(data.person.name)}足迹地图">
      <header>
        <div><div class="eyebrow">LifeTrace · 人生经纬</div><h1 class="title">${escapeHtml(data.person.title || data.person.name)}</h1><p class="subtitle">${escapeHtml(data.person.name)} ${escapeHtml(data.person.courtesyName ? '· 字' + data.person.courtesyName : '')} ${escapeHtml(data.person.years || '')}</p></div>
        <div class="amap-badge">坐标经高德开放平台校验 · ${escapeHtml(data.coordinateSystem || 'GCJ-02')}</div>
      </header>
      <svg id="mapSvg" viewBox="0 0 1000 700" role="img" aria-label="中国范围人生足迹关系图">
        <defs>
          <linearGradient id="landGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#102b40"/><stop offset="1" stop-color="#081725"/></linearGradient>
          <linearGradient id="routeGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc857"/><stop offset=".45" stop-color="#ff6d45"/><stop offset="1" stop-color="#ff3030"/></linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <path class="china-shape" d="M116 185L190 116 292 103 369 61 480 81 547 117 637 93 737 132 810 179 874 197 907 247 878 285 919 324 864 363 850 421 800 438 772 500 711 514 682 572 623 562 578 612 516 579 459 609 411 568 349 584 312 528 260 521 239 466 181 444 165 391 112 354 139 303 94 259Z"/>
        <path class="province-line" d="M203 160L269 239 251 335 313 410M369 92L394 186 480 255 544 334 528 455M635 110L620 213 703 286 688 403 772 489M139 303L273 304 391 348 516 325 642 366 850 421M260 521L356 460 470 483 578 612"/>
        <g id="routes"></g><g id="nodes"></g>
      </svg>
      <div class="stats"><div class="stat"><strong>${data.events.length}</strong><span>人生事件</span></div><div class="stat"><strong>${locations}</strong><span>地点节点</span></div><div class="stat"><strong>${phases.length}</strong><span>人生阶段</span></div></div>
      <div class="play-panel"><button class="play" id="playButton">▶ 播放足迹</button><select class="speed" id="speed" aria-label="播放速度"><option value="0.65">0.6×</option><option value="1" selected>1×</option><option value="1.8">1.8×</option></select><span class="now-year" id="nowYear">${escapeHtml(data.events[0].year)}</span></div>
    </section>
    <aside>
      <div class="side-head"><h2>一生，如何成为一条路</h2><p class="summary">${escapeHtml(data.person.summary)}</p><div class="filters">${filters}</div></div>
      <div class="timeline">${renderCards(data.events)}</div>
      <div class="footnote">路线仅表达事件发生地点的时间关系。古代行政区与现代坐标并非一一对应；标为“现代位置推定”的节点只用于空间叙事。</div>
    </aside>
  </main>
  <script>
    const DATA=${embedded};
    const svg=document.getElementById('mapSvg');
    const routeLayer=document.getElementById('routes');
    const nodeLayer=document.getElementById('nodes');
    const playButton=document.getElementById('playButton');
    const nowYear=document.getElementById('nowYear');
    const ns='http://www.w3.org/2000/svg';
    const project=([lon,lat])=>[70+(lon-73)/62*855,620-(lat-18)/36*520];
    const points=DATA.events.map((item)=>project(item.coordinates));
    let current=0,playing=false,timer=null,phase='全部阶段';
    function make(name,attrs){const element=document.createElementNS(ns,name);Object.entries(attrs).forEach(([key,value])=>element.setAttribute(key,value));return element}
    function routePath(a,b,index){const bend=(index%2?1:-1)*(32+Math.min(70,Math.abs(b[0]-a[0])*.1));const cx=(a[0]+b[0])/2,cy=(a[1]+b[1])/2+bend;return 'M '+a[0]+' '+a[1]+' Q '+cx+' '+cy+' '+b[0]+' '+b[1]}
    for(let index=1;index<points.length;index+=1){const d=routePath(points[index-1],points[index],index);const shadow=make('path',{d,class:'route-shadow'});const path=make('path',{d,class:'route-segment','data-segment':index});routeLayer.append(shadow,path);requestAnimationFrame(()=>{const length=path.getTotalLength();path.style.strokeDasharray=length;path.style.strokeDashoffset=length})}
    const labelled=[];
    DATA.events.forEach((item,index)=>{const [x,y]=points[index];const group=make('g',{class:'node'+(index===0?' active':''),'data-event-id':item.id,'data-phase':item.phase,transform:'translate('+x+' '+y+')',tabindex:'0',role:'button','aria-label':item.year+' '+item.place+' '+item.title});group.append(make('circle',{class:'halo',r:12}));group.append(make('circle',{class:'core',r:5}));const showLabel=!labelled.some(([lx,ly])=>Math.hypot(lx-x,ly-y)<58);if(showLabel){const label=make('text',{class:'node-label',x:index%2?12:-12,y:index%3? -12:22,'text-anchor':index%2?'start':'end'});label.textContent=item.place;group.append(label);const year=make('text',{class:'node-year',x:index%2?12:-12,y:index%3? 4:38,'text-anchor':index%2?'start':'end'});year.textContent=item.year;group.append(year);labelled.push([x,y])}group.addEventListener('click',()=>activate(index,true));group.addEventListener('keydown',(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate(index,true)}});nodeLayer.append(group)});
    const cards=[...document.querySelectorAll('.timeline-card')],nodes=[...document.querySelectorAll('.node')],segments=[...document.querySelectorAll('.route-segment')],shadows=[...document.querySelectorAll('.route-shadow')];
    function activate(index,scroll){current=index;cards.forEach((card,i)=>card.classList.toggle('active',i===index));nodes.forEach((node,i)=>node.classList.toggle('active',i===index));segments.forEach((segment,i)=>segment.classList.toggle('revealed',i<index));nowYear.textContent=DATA.events[index].year;if(scroll)cards[index].scrollIntoView({behavior:'smooth',block:'center'})}
    cards.forEach((card,index)=>card.addEventListener('click',(event)=>{if(event.target.closest('a,summary'))return;activate(index,false)}));
    function stop(){playing=false;clearTimeout(timer);playButton.textContent='▶ 播放足迹'}
    function step(){if(!playing)return;if(current>=DATA.events.length-1){stop();return}activate(current+1,true);const speed=Number(document.getElementById('speed').value);timer=setTimeout(step,1100/speed)}
    playButton.addEventListener('click',()=>{if(playing){stop();return}if(current>=DATA.events.length-1){segments.forEach((segment)=>segment.classList.remove('revealed'));activate(0,true)}playing=true;playButton.textContent='Ⅱ 暂停';step()});
    document.querySelectorAll('.filter').forEach((button)=>button.addEventListener('click',()=>{phase=button.dataset.phase;document.querySelectorAll('.filter').forEach((item)=>item.classList.toggle('active',item===button));cards.forEach((card)=>card.classList.toggle('hidden',phase!=='全部阶段'&&card.dataset.phase!==phase));nodes.forEach((node)=>node.style.opacity=phase==='全部阶段'||node.dataset.phase===phase?'1':'.14');segments.forEach((segment,index)=>{const eventPhase=DATA.events[index+1].phase;segment.style.opacity=phase==='全部阶段'||eventPhase===phase?'':'.05'});shadows.forEach((shadow,index)=>{const eventPhase=DATA.events[index+1].phase;shadow.style.opacity=phase==='全部阶段'||eventPhase===phase?'':'.03'})}));
    activate(0,false);
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

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ['-h', '--help', 'help'].includes(command)) {
    console.log('人生经纬 · LifeTrace\n\n用法：\n  node life-trace.mjs validate <data.json|data.csv>\n  node life-trace.mjs build <input> <output.html> [--person <name>]\n  node life-trace.mjs geocode <address>');
    return;
  }
  if (command === 'geocode') {
    if (!args[0]) throw new Error('geocode 需要地址。');
    await geocode(args.join(' '));
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
