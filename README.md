# 人生经纬 · LifeTrace

基于高德开放平台的人物一生足迹地图 Skill。它把人物经历整理为可追溯的“时间—地点—事件—来源—可信度”数据，在真实高德地图上播放动态路线，并用统一画廊展示人物形象与核心故事图。

发布地址：

- GitHub：<https://github.com/LucianaiB2004/life-trace-amap>
- ClawHub：<https://clawhub.ai/lucianaib2004/skills/life-trace>

## 功能

- 公开人物资料研究，或导入普通人的 JSON/CSV 足迹。
- 高德地理编码、真实 JS API 地图、地点标记与高德 URI。
- 路线播放、重置、阶段筛选和地图/时间线联动。
- 人物像与故事插图统一为 4:3 循环画廊。
- 史料来源与可信度标记；构建后的 Demo 自包含图片。

## 项目结构

全部 Skill 文件位于 [`life-trace/`](life-trace/)：

- `SKILL.md`：Skill 说明、工作流和教程。
- `life-trace.mjs`：数据校验、HTML 构建、预览服务和地理编码。
- `liu-bei.json`：刘备 Demo 数据。
- `demo.html`：可直接由预览服务加载的完整 Demo。
- `portrait-prompt.md`、`story-prompt.md`：人物像与核心故事图生成提示词。

## 快速开始

需要 Node.js 18 或更高版本，以及高德 Web JS API Key。

```powershell
cd "D:\Project\高德开放平台Skill\life-trace"
node life-trace.mjs validate liu-bei.json
node life-trace.mjs build liu-bei.json demo.html
$env:AMAP_KEY="你的高德 Web JS API Key"
$env:AMAP_SECURITY_KEY="对应的安全密钥（旧版 Key 可留空）"
node life-trace.mjs serve demo.html
```

在线预览地址：<https://lucianaib2004.github.io/life-trace-amap/>

运行测试：

```powershell
node --test test.mjs
```

## 隐私与安全

高德 Key 只从环境变量读取，不写入 Skill、数据或 HTML。普通人物默认只处理用户主动提供的资料；公开前应移除精确住址、联系方式、未成年人信息及未获授权的照片。
