# 巴别塔 UI v2：侧栏集中管理，中央极简

根据用户反馈重绘，使用内置 Create Image 编辑 v1，并以用户提供的 Vibe Kanban 截图为布局参考。设备选择、同步、运维、项目导航全部集中左栏；中央只显示少量任务卡；右侧详情采用渐进展示，日志和历史不同时堆叠。

浅色视觉取自本次参考图；人物、字幕、输入法浮层不进入设计。所有任务为演示内容。本文件及效果图是静态设计，不表示应用已经修改。

生成文件：[babel-dashboard-v2.png](babel-dashboard-v2.png)。实际尺寸 1586×992，原样保存，未放大。视觉检查确认：设备及同步控制已移到左栏，中央只有五张简短任务卡与大量留白，右侧只有选中任务的会话详情。

## 提示词

```text
Redesign the first reference image (our Babel/Nimbalyst UI) into a much simpler, calmer desktop UI, following the spatial simplicity and generous whitespace of the second reference image (Vibe Kanban). This is a single revised high-fidelity UI screenshot, landscape approximately 16:10. Critical user correction: ALL Ubuntu / Mac / Windows selection and all device monitoring belong in the LEFT SIDEBAR. Sidebar may be rich and hierarchical. The CENTER MUST BE EXTREMELY SIMPLE. The second image is layout reference only: exclude its presenter, webcam, subtitle, cursor, input-method overlay, branding and article text.

Use a refined LIGHT THEME like reference 2: warm off-white main canvas, pale gray sidebar, charcoal text, thin subtle dividing lines, a restrained muted teal selected accent. No forest wallpaper, glass, glow, big colored buttons, gradients, decorative metric cards or large page headings. Flat genuine productivity app UI, not marketing. Clear and legible Simplified Chinese sans-serif text. Small consistent icons. Compact top bar. Brand “巴别塔 BABEL”, discreet “Nimbalyst” below in sidebar. Tiny “设计稿” label in bottom corner.

Three-pane composition:
LEFT SIDEBAR 16% width, CENTER BOARD 57%, RIGHT SELECTED TASK CONVERSATION 27%. Vertical full-height separators. Start board columns close to top. Avoid stacking toolbar upon toolbar. No global bottom status bar.

LEFT SIDEBAR: orderly tree navigation with 18–24px row rhythm and clear groups.
Top brand; below a small search field “搜索”.
First group “工作区”: “任务看板” selected, “Agent 会话”, “项目文件”, “项目讨论”, “知识与 PDF”.
Second group “设备” with right-aligned tiny refresh icon. Nested selectable rows: “全部设备” selected with subtle pale teal background, “Ubuntu” green dot and quiet count “1”, “Windows” amber dot and quiet count “1”, “MacBook M3” gray dot. One understated helper row “每 60 秒刷新”. No big resource metrics anywhere, no duplicate device cards.
Third group “项目”: “巴别塔”, “几何滤波研究”, “个人知识库”.
Fourth group “集成”: “Google Tasks” small green dot and tiny secondary line “已同步 · 20 秒前”.
Fifth group “运维”: “GitLab”, “MediaWiki” with small dots only.
Bottom “设置”. Dense but well-organized, not multiple rounded boxes.

CENTER BOARD: only one short top row “巴别塔” on left and a small quiet “＋ 新任务” action on right. Then FOUR equal broad columns with thin vertical rules and small header names: “待办 2”, “运行 1”, “完成 1”, “归档 1”. Small colored dots by status and tiny plus or ellipsis if appropriate. All four columns fully visible. At least 65% of center board is clean empty space. Compact cards near top, no long paragraphs, no avatars, no thumbnails, no CPU numbers, no logs, no Google sync banner, no device selectors, no filter pills or control panels in the center. Each card has only a title and at most ONE quiet metadata line, with a tiny ellipsis. Card outlines thin, corners barely rounded.
Two TODO cards “PDF 行间对译” and “整理研究资料”, only first has tiny blue Google Tasks icon without a large text badge.
One RUNNING card selected by thin teal outline: “接入任务同步”, below “Pi · 运行中” in small gray type. NO DEVICE NAME in center card.
One DONE card: “统一任务状态”, small checkmark.
One ARCHIVE card: “工作台布局初稿”, tiny archive icon.
Card height roughly 64–86px, not dashboard tiles. Do not fill empty column space. There are only FIVE cards in total.

RIGHT DETAIL: clean white full-height task conversation, matching reference2 simplicity. Top title “接入任务同步” with tiny close icon; one small muted metadata line “Pi · Ubuntu · 第 2 次执行”. Device here is passive task metadata, not selector or metric. Very slim tabs “会话” selected, “差异”, “历史”.
Main white conversation has one concise assistant message:
“已完成任务映射，正在处理增量同步。”
Then three simple lines with check icons for first two:
“读取 Google Tasks”
“按任务 ID 去重”
“处理分页与断线重试”
Below one tiny subdued line “正在编辑 google-tasks.ts…”
Leave plentiful white space. No nested log panel, no execution history cards, no event timeline, no terminal, no repeated metadata. Those features live in the other tabs, not all displayed at once.
Bottom composer pinned to detail pane: simple bordered text input “补充说明…” with small attachment icon and compact send button. Above it one unobtrusive “2 个文件已修改   +42 −8” summary. No huge call to action.

Preserve user’s central model of TODO → RUNNING → DONE → ARCHIVED, single task continuity and Nimbalyst foundation. Keep all secondary controls discoverable in left sidebar, and details shown only for the selected task. This should feel like an understated editor with a sparse board, not a monitoring dashboard. No floating webcam, no photo of a person, no external explanatory annotations, no mobile inset, no duplicated alternative screens.
```
