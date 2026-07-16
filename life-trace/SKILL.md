---
name: life-trace
description: Use when creating a sourced lifetime footprint map for a historical figure, public figure, family member, or private person from public research, JSON, or CSV data, especially when the result should be an interactive HTML timeline using AMap geocoding or map links.
---

# 人生经纬 · LifeTrace

把人物经历整理为“时间—地点—事件—来源—可信度”数据，并生成可播放、可点击的动态 HTML 人生足迹图。

## 使用场景

- 为历史人物或公众人物整理公开、可引用的人生轨迹。
- 用用户提供的 JSON/CSV 制作本人、家人或纪念人物地图。
- 为教学、展览、传记和数字人文内容制作可交互时间地图。

## 工作流

1. 判断模式：公开人物走资料研究；普通人只处理用户主动提供的数据。
2. 建立事件表：记录时间、地点、事件、来源和可信度。
3. 核对地点：优先使用用户坐标；否则经用户允许后调用高德地理编码。不得用模型记忆伪造坐标。
4. 区分路线：历史人物使用地点关系线；现代导航路线只表示今天的道路，不得称为历史人物真实行程。
5. 运行校验并生成 HTML；打开页面检查动态播放、节点和侧栏联动。

## 公开人物

- 搜索公开资料并打开原始页面，不把搜索摘要当作来源。
- 每个事件至少保留一个来源；重要转折点尽量交叉核对。
- 使用 `confirmed`、`inferred`、`disputed` 表示可信度。
- 古地名映射到现代位置时保留原名，并说明推定范围。

## 普通人

- 默认不联网搜索，不从零散信息推断住址或实时位置。
- 只读取用户上传内容；发布前检查精确住址、手机号、未成年人信息和照片授权。
- CSV 缺少坐标时，列出待补地点；未经允许不得联网，也不得伪造坐标。

## 使用教程

验证数据：

```powershell
node life-trace.mjs validate liu-bei.json
```

生成公开人物地图：

```powershell
node life-trace.mjs build liu-bei.json demo.html
```

生成普通人地图：

```powershell
node life-trace.mjs build personal-template.csv my-life.html --person "我的人生地图"
```

经用户允许后用高德查询坐标：

```powershell
$env:AMAP_KEY="你的高德 Web 服务 Key"
node life-trace.mjs geocode "四川省成都市"
```

Key 只从环境变量读取，不写入 Skill、数据或 HTML。

## Demo 演示

运行 `node life-trace.mjs build liu-bei.json demo.html`，然后打开 `demo.html`：

1. 点击“播放足迹”，路线按年代逐段点亮。
2. 点击地图节点，右侧跳转到对应地点故事。
3. 点击时间轴卡片，地图聚焦并高亮该节点。
4. 点击“在高德地图查看”，用高德 URI 打开现代位置。

## 输出要求

- 保留人物标题、事件时间轴、来源、可信度和数据质量提示。
- 对无法定位的事件报错或排除出路线，不静默补造坐标。
- 最终 HTML 不包含 `AMAP_KEY` 或 `AMAP_SECURITY_KEY`。
