import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const cli = join(root, 'life-trace.mjs');

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, AMAP_KEY: '', AMAP_WEB_KEY: '', AMAP_SECURITY_KEY: '' },
  });
}

test('builds the Liu Bei dynamic HTML from verified events', () => {
  const work = mkdtempSync(join(tmpdir(), 'life-trace-'));
  const output = join(work, 'demo.html');
  try {
    const result = run('build', join(root, 'liu-bei.json'), output);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const html = readFileSync(output, 'utf8');
    assert.match(html, /人生经纬/);
    assert.match(html, /刘备/);
    assert.match(html, /data-event-id=/);
    assert.match(html, /播放足迹/);
    assert.match(html, /可信度/);
    assert.match(html, /史料来源/);
    assert.match(html, /id="amapMap"/);
    assert.match(html, /new AMap\.Map/);
    assert.match(html, /new AMap\.Marker/);
    assert.match(html, /new AMap\.Polyline/);
    assert.match(html, /new AMap\.InfoWindow/);
    assert.match(html, /data-map-theme="light"/);
    assert.match(html, />暗色<\/button>/);
    assert.match(html, />白色<\/button>/);
    assert.match(html, /map\.setMapStyle/);
    assert.match(html, /amap:\/\/styles\/normal/);
    assert.match(html, /amap:\/\/styles\/darkblue/);
    assert.match(html, /localStorage\.setItem\('life-trace-map-theme'/);
    assert.match(html, /class="story-hook/);
    assert.match(html, /item\.storyTag/);
    assert.match(html, /shell\.dataset\.theme=theme/);
    assert.match(html, /\.shell\[data-theme="light"\] aside/);
    assert.match(html, /\.amap-info-content\{[^}]*white-space:normal/);
    assert.ok(
      html.indexOf("map.on('complete'") < html.indexOf('new AMap.Marker'),
      '应在创建标记前监听地图加载完成事件',
    );
    assert.doesNotMatch(html, /id="mapSvg"|china-shape/);
    assert.doesNotMatch(html, /AMAP_(?:WEB_)?KEY\s*[:=]\s*["'][a-f0-9]{20,}/i);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('Liu Bei demo has rich sourced stories with optional typed hooks', () => {
  const data = JSON.parse(readFileSync(join(root, 'liu-bei.json'), 'utf8'));
  const tagged = data.events.filter((event) => event.storyTag);
  assert.equal(data.events.length, 15);
  assert.ok(data.events.every((event) => event.description.length >= 70), '每个地点故事应至少有 70 个字符');
  assert.ok(tagged.length >= 8, '至少 8 个事件应有第一印象标签');
  assert.ok(tagged.every((event) => ['正史有载', '文学典故', '后世概括'].includes(event.storyTagType)));
  assert.ok(tagged.some((event) => event.storyTag === '桃园结义' && event.storyTagType === '文学典故'));
  assert.ok(tagged.some((event) => event.storyTag === '白帝托孤' && event.storyTagType === '正史有载'));
});

test('ships a transparent portrait, reusable prompt, and timeline portrait card', () => {
  const portrait = readFileSync(join(root, 'liu-bei-portrait.png'));
  const prompt = readFileSync(join(root, 'portrait-prompt.md'), 'utf8');
  const skill = readFileSync(join(root, 'SKILL.md'), 'utf8');
  const html = readFileSync(join(root, 'demo.html'), 'utf8');

  assert.deepEqual([...portrait.subarray(1, 4)], [0x50, 0x4e, 0x47], '人物像应为 PNG');
  assert.ok([4, 6].includes(portrait[25]), '人物像 PNG 必须具有透明通道');
  assert.match(prompt, /\{\{人物姓名\}\}/);
  assert.match(prompt, /透明背景/);
  assert.match(prompt, /不要白色棋盘格背景/);
  assert.match(skill, /portrait-prompt\.md/);
  assert.match(html, /class="portrait-card"/);
  assert.match(html, /src="\.\/liu-bei-portrait\.png"/);
  assert.match(html, /alt="刘备人物剪纸拼贴像"/);
  assert.match(html, /\.portrait-card img\{[^}]*width:auto;[^}]*max-width:100%/);
  assert.ok(
    html.indexOf('class="portrait-card"') < html.indexOf('class="timeline-card'),
    '人物像应位于第一张时间线事件卡之前',
  );
});

test('serve refuses to start without a Web JS key', () => {
  const result = run('serve', join(root, 'demo.html'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AMAP_KEY.*Web JS/i);
});

test('serve exposes the portrait asset beside the generated HTML', async (context) => {
  const child = spawn(process.execPath, [cli, 'serve', join(root, 'demo.html'), '--port', '0'], {
    cwd: root,
    env: { ...process.env, AMAP_KEY: 'test-web-js-key', AMAP_WEB_KEY: '', AMAP_SECURITY_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(() => child.kill());

  const baseUrl = await new Promise((resolveUrl, rejectUrl) => {
    let output = '';
    const timeout = setTimeout(() => rejectUrl(new Error('预览服务启动超时：' + output)), 5000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolveUrl('http://127.0.0.1:' + match[1]);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      rejectUrl(new Error('预览服务提前退出，代码 ' + code + '：' + output));
    });
  });

  const response = await fetch(baseUrl + '/liu-bei-portrait.png', {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^image\/png/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.subarray(1, 4)], [0x50, 0x4e, 0x47]);
});

test('rejects an event without a source instead of inventing certainty', () => {
  const work = mkdtempSync(join(tmpdir(), 'life-trace-'));
  const input = join(work, 'bad.json');
  try {
    writeFileSync(input, JSON.stringify({
      person: { name: '测试人物', summary: '测试' },
      events: [{
        id: 'event-1', year: '2000', place: '北京', title: '无来源事件',
        description: '不应通过', coordinates: [116.4, 39.9], confidence: 'confirmed', sources: [],
      }],
    }), 'utf8');
    const result = run('validate', input);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /source|来源/i);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('imports a private CSV locally and keeps every story', () => {
  const work = mkdtempSync(join(tmpdir(), 'life-trace-'));
  const input = join(work, 'private.csv');
  const output = join(work, 'private.html');
  try {
    writeFileSync(input, [
      'year,place,title,description,longitude,latitude',
      '1982,成都,开始工作,在成都开始第一份工作,104.0665,30.5723',
      '1995,上海,家庭迁居,一家人搬到上海,121.4737,31.2304',
    ].join('\n'), 'utf8');
    const result = run('build', input, output, '--person', '父亲的人生地图');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const html = readFileSync(output, 'utf8');
    assert.match(html, /开始第一份工作/);
    assert.match(html, /一家人搬到上海/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('skill instructions define public research and private upload boundaries', () => {
  const skill = readFileSync(join(root, 'SKILL.md'), 'utf8');
  assert.match(skill, /^name: life-trace$/m);
  assert.match(skill, /^description: Use when /m);
  assert.match(skill, /公开人物/);
  assert.match(skill, /普通人/);
  assert.match(skill, /不得.*伪造.*坐标/);
  assert.match(skill, /现代导航路线.*历史/);
  assert.match(skill, /使用教程/);
  assert.match(skill, /demo/i);
  assert.match(skill, /life-trace\.mjs serve/);
});
