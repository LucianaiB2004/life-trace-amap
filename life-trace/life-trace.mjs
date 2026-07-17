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
    const storyHook = event.storyTag
      ? '<div class="story-hook"><span>' + escapeHtml(event.storyTag) + '</span><small>' + escapeHtml(event.storyTagType) + '</small></div>'
      : '';
    return '<article class="timeline-card' + (index === 0 ? ' active' : '') + (event.storyImage ? ' has-visual' : '') + '" data-event-id="' + escapeHtml(event.id) + '" data-phase="' + escapeHtml(event.phase) + '">'
      + '<div class="card-top"><span class="year">' + escapeHtml(event.year) + '</span><span class="confidence ' + escapeHtml(event.confidence) + '">可信度 · ' + confidenceLabels[event.confidence] + '</span></div>'
      + '<div class="place">' + escapeHtml(event.place) + '<span>' + escapeHtml(event.modernPlace || '') + '</span></div>'
      + storyHook
      + '<h3>' + escapeHtml(event.title) + '</h3>'
      + '<p>' + escapeHtml(event.description) + '</p>'
      + '<details><summary>史料来源</summary><div class="sources">' + renderSources(event.sources) + '</div></details>'
      + '<a class="amap-link" href="' + escapeHtml(amapUrl) + '" target="_blank" rel="noreferrer">在高德地图查看现代位置 ↗</a>'
      + '</article>';
  }).join('');
}

function renderPortraitGallery(person) {
  if (!person.portrait?.src) return '';
  const alt = person.portrait.alt || person.name + '人物像';
  return '<section class="portrait-gallery" aria-label="人物画廊">'
    + '<div class="module-heading"><div><small>人物画廊</small><h3>千面玄德</h3></div><div class="gallery-actions"><button type="button" class="gallery-button" data-gallery-direction="-1" aria-label="上一张人物图">←</button><button type="button" class="gallery-button" data-gallery-direction="1" aria-label="下一张人物图">→</button></div></div>'
    + '<div class="portrait-viewport"><div class="portrait-track"><figure class="portrait-card"><img src="' + escapeHtml(person.portrait.src) + '" alt="' + escapeHtml(alt) + '" width="1254" height="1254" decoding="async"><figcaption><strong>' + escapeHtml(person.name) + '</strong><span>' + escapeHtml(person.title || '人物像') + '</span></figcaption></figure></div></div>'
    + '<div class="gallery-index"><i></i><span>01 / 01 · 可左右滑动</span></div>'
    + '</section>';
}

function renderStoryVisual(events) {
  const event = events.find((item) => item.storyImage);
  if (!event) return '';
  return '<section class="story-visual" aria-live="polite">'
    + '<div class="module-heading"><div><small>核心故事图</small><h3 id="storyVisualTitle">' + escapeHtml(event.storyTag || event.title) + '</h3></div><span class="story-kind" id="storyVisualType">' + escapeHtml(event.storyTagType || '事件插图') + '</span></div>'
    + '<figure><img id="storyVisualImage" src="' + escapeHtml(event.storyImage) + '" alt="' + escapeHtml(event.storyImageAlt || event.title + '故事插图') + '" width="1536" height="1024" decoding="async"><figcaption id="storyVisualCaption">' + escapeHtml(event.year + ' · ' + event.place + ' · ' + event.title) + '</figcaption></figure>'
    + '</section>';
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
    .eyebrow{color:var(--gold);font-size:12px;font-weight:700;letter-spacing:.28em;text-transform:uppercase}.title{margin:7px 0 2px;font-size:clamp(26px,3.1vw,54px);font-family:Georgia,"Songti SC",serif;letter-spacing:.04em}.subtitle{margin:0;color:#9fb0c4;font-size:14px}.map-tools{display:flex;flex-direction:column;align-items:flex-end;gap:9px}.amap-badge{white-space:nowrap;border:1px solid rgba(92,214,255,.32);background:rgba(4,21,35,.7);color:#9be7ff;border-radius:999px;padding:9px 13px;font-size:12px}.theme-switch{display:flex;padding:3px;border:1px solid rgba(148,180,210,.3);border-radius:999px;background:rgba(4,12,24,.82);box-shadow:0 8px 24px rgba(0,0,0,.18);backdrop-filter:blur(12px)}.theme-button{min-width:52px;border:0;border-radius:999px;background:transparent;color:#9fb0c4;padding:7px 11px;font-size:12px;cursor:pointer}.theme-button.active{background:var(--gold);color:#181005;font-weight:800}
    .stats{position:absolute;left:38px;bottom:34px;z-index:5;display:flex;gap:12px}.stat{min-width:92px;padding:12px 14px;border:1px solid var(--line);background:rgba(4,12,24,.72);backdrop-filter:blur(12px)}.stat strong{display:block;color:var(--gold);font:700 22px Georgia,serif}.stat span{font-size:11px;color:var(--muted);letter-spacing:.08em}
    #amapMap{position:absolute;inset:0;z-index:1;background:#f2f5f7}.amap-logo,.amap-copyright{opacity:.65}.map-vignette{position:absolute;inset:0;z-index:2;pointer-events:none;box-shadow:inset 0 0 110px 34px rgba(2,8,17,.72);background:linear-gradient(to bottom,rgba(3,9,19,.5),transparent 28%,transparent 72%,rgba(3,9,19,.48));transition:background .25s,box-shadow .25s}.map-status{position:absolute;top:132px;left:38px;z-index:5;max-width:420px;padding:10px 13px;border:1px solid rgba(92,214,255,.3);background:rgba(4,17,31,.86);color:#a8eaff;font-size:12px;backdrop-filter:blur(10px)}.map-status.error{border-color:rgba(255,79,61,.6);color:#ffaaa0}.life-marker{position:relative;width:18px;height:18px;border:2px solid #ffe9b2;border-radius:50%;background:#ff4f3d;box-shadow:0 0 0 6px rgba(255,79,61,.18),0 0 18px rgba(255,79,61,.8);cursor:pointer;transition:transform .2s,background .2s}.life-marker:hover,.life-marker.active{transform:scale(1.35);background:var(--gold);box-shadow:0 0 0 8px rgba(255,200,87,.2),0 0 22px rgba(255,200,87,.95)}.life-marker.muted{opacity:.2}.amap-info-content{max-width:min(370px,84vw);white-space:normal!important}.life-info-content{width:min(330px,72vw);max-height:240px;overflow-x:hidden;overflow-y:auto;overflow-wrap:anywhere;white-space:normal;color:#102033;padding-right:5px}.life-info-content strong{display:block;margin-bottom:5px;font-size:15px}.life-info-content>span{color:#c33;font-weight:700}.life-info-content p{margin:7px 0 0;line-height:1.6;color:#506070;font-size:12px}.info-story-hook{display:inline-flex;margin:0 0 8px;padding:4px 8px;border-radius:999px;background:#fff1cc;color:#925b00;font-size:11px;font-weight:800}
    .map-stage[data-map-theme="light"] header{background:linear-gradient(to bottom,rgba(255,255,255,.96),rgba(255,255,255,.72) 58%,transparent)}.map-stage[data-map-theme="light"] .eyebrow{color:#b76f00}.map-stage[data-map-theme="light"] .title{color:#122033;text-shadow:0 1px 0 #fff}.map-stage[data-map-theme="light"] .subtitle{color:#50627a}.map-stage[data-map-theme="light"] .amap-badge{border-color:rgba(23,117,156,.28);background:rgba(255,255,255,.9);color:#176d8e}.map-stage[data-map-theme="light"] .theme-switch{border-color:rgba(34,58,82,.18);background:rgba(255,255,255,.92)}.map-stage[data-map-theme="light"] .theme-button{color:#53647a}.map-stage[data-map-theme="light"] .theme-button.active{color:#181005}.map-stage[data-map-theme="light"] .map-vignette{box-shadow:inset 0 0 75px 18px rgba(70,88,106,.13);background:linear-gradient(to bottom,rgba(255,255,255,.28),transparent 25%,transparent 78%,rgba(238,243,247,.45))}.map-stage[data-map-theme="light"] .map-status{border-color:rgba(23,117,156,.25);background:rgba(255,255,255,.9);color:#176d8e}.map-stage[data-map-theme="light"] .stat,.map-stage[data-map-theme="light"] .play-panel{border-color:rgba(34,58,82,.16);background:rgba(255,255,255,.9);color:#203149}.map-stage[data-map-theme="light"] .stat span{color:#64758a}.map-stage[data-map-theme="light"] .speed{border-color:rgba(34,58,82,.18);background:#fff;color:#203149}
    .play-panel{position:absolute;right:32px;bottom:34px;z-index:5;display:flex;align-items:center;gap:10px;padding:9px;border:1px solid var(--line);background:rgba(4,12,24,.84);backdrop-filter:blur(12px)}.play{border:0;background:var(--gold);color:#161004;font-weight:800;padding:10px 16px;cursor:pointer}.play:hover{background:#ffda84}.speed{border:1px solid var(--line);background:#09172a;color:var(--paper);padding:9px}.now-year{min-width:56px;text-align:center;font:700 19px Georgia,serif;color:var(--red)}
    aside{height:100vh;overflow:auto;background:rgba(7,15,29,.96);scrollbar-width:thin;scrollbar-color:#263b53 transparent;transition:background .25s,color .25s}.side-head{position:sticky;top:0;z-index:6;padding:26px 26px 19px;background:linear-gradient(to bottom,#081326 75%,rgba(8,19,38,.9));border-bottom:1px solid var(--line)}.side-head h2{margin:0 0 8px;font-size:19px}.summary{margin:0 0 14px;color:#98a9bd;font-size:13px;line-height:1.65}.filters{display:flex;gap:7px;overflow:auto;padding-bottom:3px}.filter{white-space:nowrap;border:1px solid var(--line);border-radius:999px;background:transparent;color:#9bb0c6;padding:6px 10px;font-size:11px;cursor:pointer}.filter.active{border-color:rgba(255,200,87,.5);background:rgba(255,200,87,.12);color:var(--gold)}
    .timeline{padding:20px 22px 60px}.portrait-card{position:relative;margin:0 0 18px;display:grid;place-items:center;overflow:hidden;border:1px solid rgba(255,200,87,.3);background:radial-gradient(circle at 50% 36%,#f3e4c8 0%,#d5ac75 66%,#865039 100%);box-shadow:0 16px 38px rgba(0,0,0,.24);transition:background .25s,border-color .25s,box-shadow .25s}.portrait-card:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(135deg,rgba(255,255,255,.26),transparent 42%,rgba(92,35,24,.12));z-index:0}.portrait-card img{position:relative;z-index:1;display:block;width:auto;max-width:100%;height:auto;max-height:350px;object-fit:contain;filter:drop-shadow(0 10px 12px rgba(45,22,12,.18))}.timeline-card{position:relative;margin:0 0 15px;padding:19px 18px 17px 23px;border:1px solid var(--line);background:linear-gradient(145deg,rgba(14,31,53,.82),rgba(7,17,32,.78));cursor:pointer;transition:transform .24s,border-color .24s,opacity .24s,background .25s,color .25s}.timeline-card:before{content:"";position:absolute;left:-1px;top:17px;bottom:17px;width:3px;background:#314459}.timeline-card:hover{transform:translateX(-3px);border-color:rgba(92,214,255,.32)}.timeline-card.active{border-color:rgba(255,200,87,.56);box-shadow:0 12px 40px rgba(0,0,0,.2)}.timeline-card.active:before{background:var(--gold);box-shadow:0 0 14px var(--gold)}.timeline-card.hidden{display:none}.card-top{display:flex;justify-content:space-between;gap:10px;align-items:center}.year{font:700 23px Georgia,serif;color:var(--gold)}.confidence{font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(92,214,255,.09);color:#9adff4}.confidence.inferred{background:rgba(255,200,87,.1);color:#ffd987}.confidence.disputed{background:rgba(255,79,61,.12);color:#ff9a8e}.place{margin:8px 0 2px;color:var(--red);font-size:13px;font-weight:800}.place span{margin-left:8px;color:#71869d;font-size:10px;font-weight:500}.story-hook{display:inline-flex;align-items:center;gap:7px;margin:9px 0 1px;padding:5px 9px;border:1px solid rgba(255,200,87,.28);border-radius:999px;background:rgba(255,200,87,.1);color:#ffd476}.story-hook span{font-weight:800}.story-hook small{color:#a98f63}.timeline-card h3{margin:6px 0 7px;font-size:17px}.timeline-card p{margin:0;color:#a7b7c8;line-height:1.75;font-size:12px}.timeline-card details{margin-top:12px;font-size:11px;color:#8ca1b7}.timeline-card summary{cursor:pointer;color:#bed0e0}.sources{display:flex;flex-direction:column;gap:5px;margin-top:7px}.sources a,.sources span,.amap-link{color:#75d7f4;text-decoration:none}.sources a:hover,.amap-link:hover{text-decoration:underline}.amap-link{display:inline-block;margin-top:12px;font-size:11px}
    .shell[data-theme="light"] aside{background:#eef3f6;color:#172437;scrollbar-color:#b8c6d1 transparent}.shell[data-theme="light"] .side-head{background:linear-gradient(to bottom,#f8fbfd 78%,rgba(248,251,253,.92));border-color:rgba(34,58,82,.13)}.shell[data-theme="light"] .summary{color:#607084}.shell[data-theme="light"] .filter{border-color:rgba(34,58,82,.16);color:#5b6c80}.shell[data-theme="light"] .filter.active{border-color:#c88a20;background:#fff1cf;color:#8a5700}.shell[data-theme="light"] .portrait-card{border-color:rgba(149,94,35,.24);background:radial-gradient(circle at 50% 36%,#fffdf7 0%,#f3dfba 72%,#d5a976 100%);box-shadow:0 14px 34px rgba(75,50,28,.13)}.shell[data-theme="light"] .timeline-card{border-color:rgba(34,58,82,.13);background:#fff;color:#172437;box-shadow:0 8px 26px rgba(39,61,79,.06)}.shell[data-theme="light"] .timeline-card:hover{border-color:rgba(26,130,168,.35)}.shell[data-theme="light"] .timeline-card.active{border-color:#d3a03d;box-shadow:0 13px 34px rgba(39,61,79,.12)}.shell[data-theme="light"] .year{color:#a56500}.shell[data-theme="light"] .confidence{background:#e9f6fa;color:#28728a}.shell[data-theme="light"] .confidence.inferred{background:#fff2d2;color:#916000}.shell[data-theme="light"] .place span{color:#728296}.shell[data-theme="light"] .story-hook{border-color:#e4b654;background:#fff3d5;color:#8b5700}.shell[data-theme="light"] .story-hook small{color:#9b7840}.shell[data-theme="light"] .timeline-card p{color:#4f6073}.shell[data-theme="light"] .timeline-card details,.shell[data-theme="light"] .timeline-card summary{color:#62778c}.shell[data-theme="light"] .sources a,.shell[data-theme="light"] .amap-link{color:#087b9f}.shell[data-theme="light"] .footnote{color:#68798c}
    .footnote{padding:0 24px 36px;color:#6f8298;font-size:11px;line-height:1.65}
    /* 历史博物馆式地图 */
    :root{--museum-red:#a92f24;--museum-gold:#b98534;--museum-paper:#f5efe3;--museum-ink:#201a16;--museum-night:#121517}
    body:before{background:radial-gradient(circle at 18% 22%,rgba(161,45,34,.09),transparent 30%),radial-gradient(circle at 78% 10%,rgba(185,133,52,.08),transparent 28%)}
    .shell{grid-template-columns:minmax(0,2.12fr) minmax(390px,1fr);background:var(--museum-night)}
    .map-stage{border-right-color:rgba(92,66,36,.28)}
    .map-stage header{padding:24px 28px;background:linear-gradient(to bottom,rgba(12,15,17,.86),rgba(12,15,17,.24) 72%,transparent)}
    .person-plaque{display:flex;align-items:center;gap:13px;max-width:min(470px,58vw);padding:10px 16px 10px 10px;border:1px solid rgba(221,184,116,.35);border-radius:3px;background:rgba(17,20,21,.83);box-shadow:0 18px 45px rgba(0,0,0,.24);backdrop-filter:blur(16px)}
    .person-plaque>img{width:66px;height:66px;object-fit:contain;flex:0 0 auto;filter:drop-shadow(0 6px 7px rgba(0,0,0,.28))}.person-plaque .eyebrow{font-size:9px;color:#d7ad68}.person-plaque .title{margin:3px 0 1px;font-size:30px;line-height:1;font-family:"STKaiti","KaiTi",Georgia,serif}.person-plaque .subtitle{font-size:11px;color:#c6bbaa}
    .map-tools{gap:8px}.amap-badge,.theme-switch{border-radius:3px}.theme-switch{padding:4px}.theme-button{border-radius:2px}.theme-button.active{background:var(--museum-red);color:#fff7e8}
    .map-status{top:116px;left:28px;border-radius:2px}.stats{left:28px;top:155px;bottom:auto;flex-direction:column;gap:7px}.stat{min-width:78px;padding:8px 11px;border-radius:2px}.stat strong{font-size:17px}.stat span{font-size:9px}
    .play-panel{left:50%;right:auto;bottom:24px;transform:translateX(-50%);width:min(570px,calc(100% - 48px));display:block;padding:10px 12px;border-radius:4px;border-color:rgba(221,184,116,.34);background:rgba(18,21,23,.9);box-shadow:0 20px 55px rgba(0,0,0,.3);backdrop-filter:blur(18px)}
    .play-actions{display:flex;align-items:center;gap:9px}.play,.reset{min-height:38px;border-radius:2px}.play{flex:1;background:var(--museum-red);color:#fff7eb}.play:hover{background:#c44234}.reset{border:1px solid rgba(221,184,116,.35);background:transparent;color:#ead5af;padding:8px 13px;cursor:pointer}.reset:hover{background:rgba(221,184,116,.11)}.speed{border-radius:2px}.now-year{color:#dbb56f;font-size:18px}
    .progress-line{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;margin-top:9px}.route-progress{height:3px;overflow:hidden;background:rgba(226,211,181,.16)}.route-progress i{display:block;height:100%;background:linear-gradient(90deg,var(--museum-red),#deb66b);transition:width .28s ease}.progress-line span{color:#aa9f8e;font-size:10px;font-variant-numeric:tabular-nums}
    aside{background:#151719;color:#eee5d6;scrollbar-color:#5a4937 transparent}.side-head{padding:24px 24px 17px;background:linear-gradient(to bottom,#17191b 82%,rgba(23,25,27,.93));border-color:rgba(197,157,90,.22)}.side-kicker{margin-bottom:8px;color:#b78a46;font-size:9px;font-weight:800;letter-spacing:.22em}.side-head h2{font-family:"STKaiti","KaiTi",serif;font-size:22px}.summary{color:#aaa093;font-size:12px;line-height:1.75}.filters{scrollbar-width:none}.filter{border-radius:2px;border-color:rgba(202,173,124,.22);color:#b9ad9d}.filter.active{border-color:#a92f24;background:#a92f24;color:#fff6e8}
    .timeline{padding:18px 20px 56px}.module-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.module-heading small{display:block;color:#a98042;font-size:9px;font-weight:800;letter-spacing:.18em}.module-heading h3{margin:3px 0 0;font:700 18px "STKaiti","KaiTi",serif}.portrait-gallery,.story-visual{margin-bottom:18px;padding:14px;border:1px solid rgba(202,173,124,.22);background:#1d2022;box-shadow:0 14px 34px rgba(0,0,0,.18)}
    .gallery-actions{display:flex;gap:5px}.gallery-button{width:31px;height:28px;border:1px solid rgba(202,173,124,.25);border-radius:2px;background:transparent;color:#d9c6a5;cursor:pointer}.gallery-button:hover{border-color:#b98534;background:rgba(185,133,52,.1)}.portrait-viewport{overflow:hidden}.portrait-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-inline:contain;touch-action:pan-x}.portrait-track::-webkit-scrollbar{display:none}
    .portrait-card{flex:0 0 100%;scroll-snap-align:start;margin:0;min-width:0;min-height:250px;border:0;background:radial-gradient(circle at 50% 36%,#f2e2c3 0%,#d9b17c 70%,#84503a 100%);box-shadow:none}.portrait-card img{max-height:265px}.portrait-card figcaption{position:absolute;left:10px;right:10px;bottom:9px;z-index:2;display:flex;align-items:end;justify-content:space-between;padding:22px 10px 9px;background:linear-gradient(transparent,rgba(42,24,17,.82));color:#fff8eb}.portrait-card figcaption strong{font:700 20px "STKaiti","KaiTi",serif}.portrait-card figcaption span{font-size:9px;color:#dec8a5}.gallery-index{display:flex;align-items:center;gap:9px;margin-top:10px;color:#958b7e;font-size:9px}.gallery-index i{width:34px;height:2px;background:#a92f24}
    .story-kind{padding:4px 7px;border:1px solid rgba(169,47,36,.4);border-radius:2px;color:#d9a29b;font-size:9px}.story-visual figure{margin:0;overflow:hidden;background:#0f1112}.story-visual img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;transition:opacity .12s ease,transform .25s ease}.story-visual img.changing{opacity:.2;transform:scale(.985)}.story-visual figcaption{padding:10px 1px 1px;color:#aaa093;font-size:10px;line-height:1.5}
    .timeline-heading{display:flex;align-items:center;justify-content:space-between;margin:28px 2px 13px;padding-bottom:9px;border-bottom:1px solid rgba(202,173,124,.2)}.timeline-heading span{font:700 18px "STKaiti","KaiTi",serif}.timeline-heading b{color:#9d8d78;font-size:9px;font-weight:500}
    .timeline-card{border-color:rgba(202,173,124,.17);border-radius:2px;background:#1b1e20}.timeline-card:before{background:#51483c}.timeline-card:hover{border-color:rgba(185,133,52,.48)}.timeline-card.active{border-color:#a92f24;box-shadow:0 12px 34px rgba(0,0,0,.22)}.timeline-card.active:before{background:#a92f24;box-shadow:0 0 13px rgba(169,47,36,.55)}.timeline-card.has-visual:after{content:"有故事图";position:absolute;right:17px;bottom:15px;color:#a98042;font-size:9px;letter-spacing:.08em}.year{color:#c69a53}.place{color:#ca4b3e}.timeline-card p{color:#b5aca0}.story-hook{border-radius:2px;border-color:rgba(185,133,52,.35);background:rgba(185,133,52,.1);color:#dcb56f}
    .shell[data-theme="light"] aside{background:#efe9dd;color:#2a241e;scrollbar-color:#b6a58e transparent}.shell[data-theme="light"] .side-head{background:linear-gradient(to bottom,#f7f2e8 82%,rgba(247,242,232,.94));border-color:rgba(89,64,38,.18)}.shell[data-theme="light"] .summary{color:#6d6358}.shell[data-theme="light"] .portrait-gallery,.shell[data-theme="light"] .story-visual{border-color:rgba(89,64,38,.18);background:#faf6ed;box-shadow:0 12px 28px rgba(64,46,28,.08)}.shell[data-theme="light"] .module-heading h3,.shell[data-theme="light"] .timeline-heading{color:#2a241e}.shell[data-theme="light"] .gallery-button{border-color:rgba(89,64,38,.22);color:#6c5537}.shell[data-theme="light"] .story-visual figure{background:#e3d9c8}.shell[data-theme="light"] .story-visual figcaption{color:#6d6358}.shell[data-theme="light"] .timeline-card{border-color:rgba(89,64,38,.14);background:#faf7f0;color:#2a241e;box-shadow:0 7px 22px rgba(64,46,28,.05)}.shell[data-theme="light"] .timeline-card.active{border-color:#a92f24;box-shadow:0 12px 30px rgba(64,46,28,.11)}.shell[data-theme="light"] .timeline-card p{color:#655d54}.shell[data-theme="light"] .filter{border-color:rgba(89,64,38,.2);color:#685b4c}.shell[data-theme="light"] .filter.active{border-color:#a92f24;background:#a92f24;color:#fff8eb}.map-stage[data-map-theme="light"] .person-plaque{border-color:rgba(91,65,36,.2);background:rgba(255,252,246,.91);box-shadow:0 16px 36px rgba(54,46,37,.12)}.map-stage[data-map-theme="light"] .person-plaque .title{color:#241e19}.map-stage[data-map-theme="light"] .play-panel{border-color:rgba(91,65,36,.2);background:rgba(255,252,246,.92);color:#2a241e}.map-stage[data-map-theme="light"] .reset{border-color:rgba(91,65,36,.22);color:#6b563b}.map-stage[data-map-theme="light"] .route-progress{background:rgba(91,65,36,.14)}
    @media(max-width:1050px){.shell{grid-template-columns:minmax(0,1.75fr) minmax(350px,1fr)}.person-plaque{max-width:52vw}.amap-badge{display:none}.stats{display:none}}
    @media(max-width:900px){.shell{display:block;height:auto;overflow:visible}.map-stage{height:72vh;min-height:560px;border-right:0;border-bottom:1px solid var(--line)}aside{height:auto;overflow:visible}.side-head{position:relative}.map-stage header{padding:18px}.person-plaque{max-width:70vw}.map-status{top:102px;left:18px}.play-panel{bottom:16px;width:calc(100% - 32px)}.timeline{max-width:720px;margin:auto}.story-visual img{max-height:none}}
    @media(max-width:560px){.map-stage{height:76vh;min-height:590px}.person-plaque{max-width:calc(100vw - 116px);padding:7px 9px 7px 7px}.person-plaque>img{width:50px;height:50px}.person-plaque .title{font-size:24px}.person-plaque .subtitle{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.theme-button{min-width:44px;padding:6px 8px}.map-status{top:89px;max-width:calc(100% - 36px)}.play-actions{display:grid;grid-template-columns:1fr auto auto}.play{min-width:0}.now-year{grid-column:1/-1;text-align:left;font-size:15px}.timeline{padding:14px 12px 40px}.side-head{padding:21px 16px}.portrait-gallery,.story-visual{padding:11px}.portrait-card{min-height:225px}.portrait-card img{max-height:235px}.timeline-card{padding:17px 15px 16px 19px}.timeline-card.has-visual:after{display:none}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important;transition:none!important}}
  </style>
</head>
<body>
  <main class="shell" data-theme="light">
    <section class="map-stage" data-map-theme="light" aria-label="${escapeHtml(data.person.name)}足迹地图">
      <header>
        <div class="person-plaque">${data.person.portrait?.src ? '<img src="' + escapeHtml(data.person.portrait.src) + '" alt="" width="1254" height="1254">' : ''}<div><div class="eyebrow">LifeTrace · 人生经纬</div><h1 class="title">${escapeHtml(data.person.name)}</h1><p class="subtitle">${escapeHtml(data.person.courtesyName ? '字' + data.person.courtesyName + ' · ' : '')}${escapeHtml(data.person.years || '')} · ${escapeHtml(data.person.title || '人物足迹')}</p></div></div>
        <div class="map-tools"><div class="amap-badge" id="amapBadge">正在连接高德地图 · ${escapeHtml(data.coordinateSystem || 'GCJ-02')}</div><div class="theme-switch" role="group" aria-label="地图颜色"><button type="button" class="theme-button" data-map-theme-option="dark" aria-pressed="false">暗色</button><button type="button" class="theme-button active" data-map-theme-option="light" aria-pressed="true">白色</button></div></div>
      </header>
      <div id="amapMap" role="application" aria-label="真实高德地图上的人生足迹"></div>
      <div class="map-vignette"></div>
      <div class="map-status" id="mapStatus">正在加载高德 JS API 2.0…</div>
      <div class="stats"><div class="stat"><strong>${data.events.length}</strong><span>人生事件</span></div><div class="stat"><strong>${locations}</strong><span>地点节点</span></div><div class="stat"><strong>${phases.length}</strong><span>人生阶段</span></div></div>
      <div class="play-panel"><div class="play-actions"><button class="play" id="playButton">▶ 播放足迹</button><button class="reset" id="resetButton" type="button" aria-label="重置人生足迹播放">↺ 重置</button><select class="speed" id="speed" aria-label="播放速度"><option value="0.65">0.6×</option><option value="1" selected>1×</option><option value="1.8">1.8×</option></select><span class="now-year" id="nowYear">${escapeHtml(data.events[0].year)}</span></div><div class="progress-line"><div class="route-progress" id="routeProgress" role="progressbar" aria-label="人生足迹播放进度" aria-valuemin="1" aria-valuemax="${data.events.length}" aria-valuenow="1"><i id="progressFill" style="width:${100 / data.events.length}%"></i></div><span id="progressText">1 / ${data.events.length}</span></div></div>
    </section>
    <aside>
      <div class="side-head"><div class="side-kicker">数字人物馆 · 蜀汉篇</div><h2>一生，如何成为一条路</h2><p class="summary">${escapeHtml(data.person.summary)}</p><div class="filters">${filters}</div></div>
      <div class="timeline">${renderPortraitGallery(data.person)}${renderStoryVisual(data.events)}<div class="timeline-heading"><span>人生纪事</span><b>${data.events.length} 个节点</b></div>${renderCards(data.events)}</div>
      <div class="footnote">路线仅表达事件发生地点的时间关系。古代行政区与现代坐标并非一一对应；标为“现代位置推定”的节点只用于空间叙事。</div>
    </aside>
  </main>
  <script src="/__lifetrace_amap_config__.js"></script>
  <script>
    const DATA=${embedded};
    const CONFIG=window.__LIFETRACE_AMAP_CONFIG__;
    const shell=document.querySelector('.shell');
    const mapElement=document.getElementById('amapMap');
    const mapStage=document.querySelector('.map-stage');
    const mapStatus=document.getElementById('mapStatus');
    const amapBadge=document.getElementById('amapBadge');
    const themeButtons=[...document.querySelectorAll('[data-map-theme-option]')];
    const playButton=document.getElementById('playButton');
    const resetButton=document.getElementById('resetButton');
    const nowYear=document.getElementById('nowYear');
    const routeProgress=document.getElementById('routeProgress');
    const progressFill=document.getElementById('progressFill');
    const progressText=document.getElementById('progressText');
    const storyVisualImage=document.getElementById('storyVisualImage');
    const storyVisualTitle=document.getElementById('storyVisualTitle');
    const storyVisualType=document.getElementById('storyVisualType');
    const storyVisualCaption=document.getElementById('storyVisualCaption');
    const portraitTrack=document.querySelector('.portrait-track');
    const cards=[...document.querySelectorAll('.timeline-card')];
    let map,infoWindow,markers=[],segments=[],current=0,playing=false,timer=null,phase='全部阶段',theme=readStoredTheme();

    function readStoredTheme(){try{const stored=localStorage.getItem('life-trace-map-theme');return stored==='dark'||stored==='light'?stored:'light'}catch{return 'light'}}
    function mapStyleForTheme(value){return value==='dark'?'amap://styles/darkblue':'amap://styles/normal'}
    function applyTheme(value,persist=true){theme=value==='dark'?'dark':'light';shell.dataset.theme=theme;mapStage.dataset.mapTheme=theme;themeButtons.forEach((button)=>{const active=button.dataset.mapThemeOption===theme;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});if(map)map.setMapStyle(mapStyleForTheme(theme));if(persist){try{localStorage.setItem('life-trace-map-theme',theme)}catch{}}}
    function setStatus(message,state){mapStatus.textContent=message;mapStatus.classList.toggle('error',state==='error');mapStatus.dataset.state=state;amapBadge.textContent=state==='ready'?'高德地图已连接 · '+(DATA.coordinateSystem||'GCJ-02'):message}
    function loadAmap(){return new Promise((resolve,reject)=>{if(!CONFIG||!CONFIG.key){reject(new Error('未收到 AMAP_KEY，请使用 life-trace.mjs serve 启动'));return}if(CONFIG.securityKey)window._AMapSecurityConfig={securityJsCode:CONFIG.securityKey};const script=document.createElement('script');script.src='https://webapi.amap.com/maps?v=2.0&key='+encodeURIComponent(CONFIG.key)+'&plugin=AMap.Scale,AMap.ToolBar';script.onload=()=>window.AMap?resolve(window.AMap):reject(new Error('高德 JS API 未创建 AMap 对象'));script.onerror=()=>reject(new Error('高德 JS API 加载失败，请检查网络、Key 类型和域名白名单'));document.head.append(script)})}
    function markerContent(item,index){const button=document.createElement('button');button.type='button';button.className='life-marker'+(index===0?' active':'');button.dataset.eventId=item.id;button.dataset.phase=item.phase;button.title=item.year+' · '+item.place+' · '+item.title;button.setAttribute('aria-label',button.title);return button}
    function infoContent(item){const box=document.createElement('div');box.className='life-info-content';if(item.storyTag){const hook=document.createElement('div');hook.className='info-story-hook';hook.textContent=item.storyTag+' · '+item.storyTagType;box.append(hook)}const title=document.createElement('strong');title.textContent=item.title;const meta=document.createElement('span');meta.textContent=item.year+' · '+item.place;const body=document.createElement('p');body.textContent=item.description;box.append(title,meta,body);return box}
    function lineVisible(index){return index<current&&(phase==='全部阶段'||DATA.events[index+1].phase===phase)}
    function syncMapState(focus){markers.forEach((marker,index)=>{const allowed=phase==='全部阶段'||DATA.events[index].phase===phase;allowed?marker.show():marker.hide();marker.getContent().classList.toggle('active',index===current)});segments.forEach((segment,index)=>lineVisible(index)?segment.show():segment.hide());if(focus&&map){map.panTo(DATA.events[current].coordinates);openInfo(current)}}
    function openInfo(index){if(!map||!infoWindow)return;infoWindow.setContent(infoContent(DATA.events[index]));infoWindow.open(map,DATA.events[index].coordinates)}
    function updateStoryVisual(item){if(!item.storyImage||!storyVisualImage)return;storyVisualImage.classList.add('changing');setTimeout(()=>{storyVisualImage.src=item.storyImage;storyVisualImage.alt=item.storyImageAlt||item.title+'故事插图';storyVisualTitle.textContent=item.storyTag||item.title;storyVisualType.textContent=item.storyTagType||'事件插图';storyVisualCaption.textContent=item.year+' · '+item.place+' · '+item.title;storyVisualImage.classList.remove('changing')},120)}
    function updateProgress(){const step=current+1;const percent=step/DATA.events.length*100;progressFill.style.width=percent+'%';progressText.textContent=step+' / '+DATA.events.length;routeProgress.setAttribute('aria-valuenow',String(step))}
    function activate(index,scroll,focus){current=index;cards.forEach((card,i)=>card.classList.toggle('active',i===index));nowYear.textContent=DATA.events[index].year;updateProgress();updateStoryVisual(DATA.events[index]);syncMapState(focus);if(scroll)cards[index].scrollIntoView({behavior:'smooth',block:'center'})}
    function stop(){playing=false;clearTimeout(timer);playButton.textContent='▶ 播放足迹'}
    function resetPlayback(){stop();activate(0,true,false);phase='全部阶段';document.querySelectorAll('.filter').forEach((button)=>button.classList.toggle('active',button.dataset.phase==='全部阶段'));cards.forEach((card)=>card.classList.remove('hidden'));syncMapState(false);if(infoWindow)infoWindow.close();if(map&&markers.length)map.setFitView(markers,false,[120,80,125,80],5)}
    function step(){if(!playing)return;if(current>=DATA.events.length-1){stop();return}activate(current+1,true,true);const speed=Number(document.getElementById('speed').value);timer=setTimeout(step,1100/speed)}

    async function initAmap(){
      try{
        const AMap=await loadAmap();
        map=new AMap.Map('amapMap',{center:[110.2,32.7],zoom:4,zooms:[3,18],mapStyle:mapStyleForTheme(theme),viewMode:'2D',resizeEnable:true});
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
    themeButtons.forEach((button)=>button.addEventListener('click',()=>applyTheme(button.dataset.mapThemeOption)));
    playButton.addEventListener('click',()=>{if(playing){stop();return}if(current>=DATA.events.length-1)activate(0,true,true);playing=true;playButton.textContent='Ⅱ 暂停';step()});
    resetButton.addEventListener('click',resetPlayback);
    document.querySelectorAll('[data-gallery-direction]').forEach((button)=>button.addEventListener('click',()=>{if(!portraitTrack)return;portraitTrack.scrollBy({left:Number(button.dataset.galleryDirection)*portraitTrack.clientWidth,behavior:'smooth'})}));
    document.querySelectorAll('.filter').forEach((button)=>button.addEventListener('click',()=>{phase=button.dataset.phase;document.querySelectorAll('.filter').forEach((item)=>item.classList.toggle('active',item===button));cards.forEach((card)=>card.classList.toggle('hidden',phase!=='全部阶段'&&card.dataset.phase!==phase));syncMapState(false);const visibleMarkers=markers.filter((marker,index)=>phase==='全部阶段'||DATA.events[index].phase===phase);if(map&&visibleMarkers.length)map.setFitView(visibleMarkers,false,[120,80,125,80],5)}));
    applyTheme(theme,false);
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
    if (/^\/[a-z0-9][a-z0-9._-]*\.png$/i.test(url.pathname)) {
      try {
        const asset = readFileSync(resolve(dirname(input), url.pathname.slice(1)));
        response.writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store, max-age=0',
        });
        response.end(asset);
        return;
      } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
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
