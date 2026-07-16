import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const cli = join(root, 'life-trace.mjs');

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, AMAP_KEY: '' },
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
    assert.doesNotMatch(html, /AMAP_(?:WEB_)?KEY\s*[:=]\s*["'][a-f0-9]{20,}/i);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
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
});
