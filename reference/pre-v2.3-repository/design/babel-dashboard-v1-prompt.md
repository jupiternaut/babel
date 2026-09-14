# 巴别塔前端效果图 v1

用途：Nimbalyst 底座的桌面端 UI 概念图。使用内置 Create Image / image_gen；所有任务、时间与设备指标是演示数据，不表示已部署。

生成原图：[babel-dashboard-v1.png](babel-dashboard-v1.png)。从工具输出原样复制，未重绘或放大；实际读取尺寸为 1586×992，文件大小 1,548,241 字节。提示词中的目标尺寸不是输出证明。

视觉检查：四个阶段、任务数量、设备状态、Google Tasks 来源、选中运行卡与详情关联、执行历史均已呈现。图中人名头像和监控指标为生成的演示内容，实际产品应读取用户账户和真实遥测。此图为静态设计稿，不具备鼠标交互或后台功能。

## 搜索参考

- Nimbalyst 任务看板与详情：https://www.nimbalyst.com/teams/trackers/
- Nimbalyst 官方界面文档：https://docs.nimbalyst.com/task-management/kanban-and-list
- Vibe Kanban 工作区界面：https://www.vibekanban.com/docs/workspaces/interface-guide
- Cline Kanban：https://github.com/cline/kanban
- Hermes 官方看板教程：https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban-tutorial
- Cursor Agent Kanban：https://github.com/cursor/cookbook/tree/main/sdk/agent-kanban

已检索上述看板截图及界面说明。部分官方图片直链获取失败；未将远程图片下载为编辑素材。生成输入为下面的文字设计规格，并参考此前用户提供的低分辨率桌面/看板视觉方向。搜索结果不是所有当前版本外观的一致性保证。

## 最终生成提示词

```text
Create a polished high-fidelity desktop application UI mockup, one single flat front-facing screenshot, for “巴别塔 / BABEL”, a customized Nimbalyst workspace. This is a frontend concept image, NOT a diagram, marketing landing page, photograph, or device mockup. Wide landscape 16:10 composition, target 2560x1600 if supported; prioritize very crisp legible Simplified Chinese typography and generously sized UI. Fill the image with the actual app.

Design research translated into visual direction: Nimbalyst supplies the desktop app shell, left project/session navigation, task tracker and integrated right detail pane; Vibe Kanban supplies horizontal task columns and run/review lifecycle; Cline Kanban supplies latest agent activity on each card plus terminal/diff access; Hermes supplies durable run history and device/gateway status; Cursor agent-kanban supplies tidy filter controls, repo/branch metadata and result previews. Create an original unified product, not a collage of five apps. Main base must remain a Nimbalyst-style editor/agent workspace.

Appearance: sophisticated restrained dark mode, graphite and deep forest-green neutrals, warm off-white text, mint selected accents, amber waiting indicators, desaturated violet archive accents. Minimal soft misty forest wallpaper visible only through a narrow top chrome and the left rail, recalling a calm Ubuntu desktop; reading surfaces almost opaque. Thin one-pixel separators, modest 6–8px corner radii, small precise line icons, beautiful spacing. Normal proportional modern sans-serif Chinese type, monospace only in logs. No neon glow, huge gradients, decorative charts, futuristic holograms or excessive glass. This should look like a real desktop application professionally designed for daily work.

Layout:
Top slim app chrome: small original geometric mark then “巴别塔 BABEL” and discreet “Nimbalyst 工作台”; active workspace “个人工作台”. Right side search icon and a legible subtle label “概念设计 · 演示数据”.
Left sidebar ~12% width: selected “任务看板”, then “Agent 会话”, “项目文件”, “项目讨论”, “设备与运维”, “知识与 PDF”. Below PROJECTS / 项目 list “巴别塔”, “几何滤波研究”, “个人知识库”. Footer has settings and small user avatar. Keep side navigation tidy with hierarchical typography.

Main area ~88% width. Heading row “任务与 Agent” and small “所有项目” / “所有设备” dropdowns; far right mint primary button “＋ 新建任务”.
Immediately below a thin Google Tasks integration strip: recognizable small blue task-check icon, “Google Tasks 已连接”, “20 秒前同步”, “每 60 秒检查”; trailing text “导入为待办” and secondary “立即同步”.
Next a compact single horizontal row of three device summaries, NOT oversized analytics cards:
“Ubuntu” green status dot “在线” | “Pi · 1 运行” | “CPU 42% / 内存 58%”
“Windows” green dot “在线” | “Codex · 待输入” | “CPU 18% / 内存 46%”
“MacBook M3” muted dot “休眠” | “最后在线 12 分钟前”
At right of row or adjacent concise label “SSH 状态 · 每 60 秒刷新”.

Below is the main workspace: four clearly separated vertical task columns occupy ~72% of remaining width, and a persistent right-hand task detail panel occupies ~28%. All four columns and all headings are fully visible, none cropped:
“待办 TODO  3”, “运行 RUNNING  2”, “完成 DONE  2”, “归档 ARCHIVED  1”.
Use distinct tiny colored dots in headings, subtle counts, plus/ellipsis controls. Cards have meaningful whitespace and large legible titles, small metadata and quiet outlines.

TODO cards:
“PDF 行间对译” with blue “Google Tasks” source chip, “个人知识库”, small “选择设备” and play action.
“桌面文件归档” with “Google Tasks” source chip and “文件整理”.
“MediaWiki 搜索优化” with “项目讨论” source chip.
Running card 1 selected with a thin mint outline:
“接入 Google Tasks 同步”, “Pi · Ubuntu”, small repo text “babel / feat/tasks-sync”, green pill “正在执行”, latest activity “正在实现分页与去重”, elapsed “08:32”. No invented percentage progress bar.
Running card 2:
“完善设备采集”, “Codex · Windows”, amber pill “等待输入”, latest activity “请选择监控目录”, small “回复” action.
DONE cards:
“统一任务状态” green check, “验证通过”, “查看结果” and subtle archive icon.
“添加归档入口” green check, “完成于 10:24”, tiny file-result thumbnail.
ARCHIVED card:
“工作台布局初稿”, quieter opacity but fully readable, label “已完成 · 已归档”, action “恢复”. No trash-can metaphor for archives.
Enough empty column space below cards to make the board restful.

Right detail pane shows the SAME selected running task, “接入 Google Tasks 同步”, ID “BABEL-028”, “Pi / Ubuntu” green status “运行中”. Tabs “会话” (selected), “差异”, “产物”, “历史”. Neat structured agent activity:
10:36 “已读取同步接口”
10:38 “已建立任务 ID 映射”
10:41 “正在实现分页与去重”
Small understated terminal area with “src/connectors/google-tasks.ts” and two or three realistic concise code/log lines, no giant code wall.
A section “执行记录” with current “第 2 次执行 · 运行中” and a smaller previous “第 1 次 · 已中断” so history is preserved rather than duplicating cards.
At bottom of this pane an input box “补充说明或回复 Agent…” and a send icon, nearby subdued “停止运行” action.
Bottom application status bar: green indicators “GitLab 正常”, “MediaWiki 正常”, “Homepage 正常”, “事件已连接”, plus “设备状态 18 秒前更新”. These are explicitly fictional demonstration values per the top label.

Functional visual constraints: a single unified board, same task card progresses across states; completed and archived visually distinct; waiting input is not completed; sleeping device has no live-looking metrics. Mouse-interactive affordances visible. No additional logos for Hermes/Cline/Vibe Kanban, no company comparison chart, no explanatory arrows or notes outside UI, no browser address bar, no excessive English filler, no lorem ipsum, no fabricated real IP addresses. Make it feel immediately implementable within Nimbalyst.
```
