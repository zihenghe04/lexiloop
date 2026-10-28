# LexiLoop 0.16.5 Anthropic端点切换与界面优化验证

日期：2026-10-22。

## 端点切换

Anthropic 兼容服务 预设请求地址由 `https://api.example.com/deployer/coding_tatu/v1/messages` 改为
`https://api.example.com/v1/messages`（sidepanel.js、translation-providers.js、tests/preview-mocks.js；
sidepanel.html 的地址候选列表保留三个历史选项）。

## 真实接口（经用户授权，使用本机已保存的Anthropic Key，密钥未写入项目）

- 非流式 `POST /v1/messages`，model=claude-sonnet-5-5：**HTTP 200**，返回正常 `message` 结构与用量统计。
  首次请求出现一次 502 `upstream_timeout_error`（上游 aigw.bce.baidu.com 连接超时），重试后成功。
- 流式 `stream:true`：**HTTP 200**，收到完整 `message_start → content_block_delta → message_stop` SSE 事件序列。
  也观察到一次间歇性 502，重试成功。
- 结论：2026-10-13 的 503（app_id 不支持）已消失，该 Key/模型组合当前可用；
  上游存在**间歇性 502 超时**，为平台侧问题，插件的失败重发即可应对。

## 界面与交互优化（参考 cynicalight/reader）

- **选中文字 → 问 AI**：PDF 选区工具栏新增「问 AI」，直接打开 AI 面板并就所选内容提问（AI 忙时填入输入框）。
- **阅读主题**：顶栏新增主题按钮，浅色 / 纸张 / 深色 循环切换并记忆；深色下 PDF 页面与缩略图自动反色，打印不受影响。
- **批注筛选**：批注侧栏新增按颜色筛选条（全部/黄/绿/粉/蓝）。
- **侧边栏**：词库词条标题可点击一键重新翻译；`/` 快捷键聚焦当前页搜索框（查词/词库/文献）。

## 自动化

`node --test tests/*.test.cjs`：114 项，112 通过，0 失败，2 跳过（与 0.16.4 基线一致）。
`node --check` 通过；manifest 版本 0.16.5。

## 应用更新

在 `chrome://extensions` 重新加载此目录的 LexiLoop，再刷新已打开的 PDF 阅读器页面。
已保存的真实配置与密钥未被修改；原方案配置不受影响。

## 0.16.6 修复：文献库「继续阅读」无法打开 PDF

- 根因：0.16.5 新增阅读主题时，`READER_THEME_LABELS` 以 `const` 声明在 pdf-reader.js 中部，但脚本顶层已提前调用
  `applyReaderTheme()`，触发 TDZ `ReferenceError`，`initialize()` 未执行，阅读器无法加载任何 PDF（继续阅读首当其冲）。
- 修复：常量移至文件顶部其他主题常量旁；新增 `tests/reader-init-order.test.cjs` 回归测试。
- 用 Node 桩环境执行 pdf-reader.html 引用的全部脚本对照：修复前在第 828 行抛错，修复后顶层加载通过并进入 `initialize()`。
- 顺带修复 content.js 中 `event.key` 为空时（输入法、自动填充事件）`startsWith` 报错。

## 0.16.6 动效层

pdf-reader.css 末尾新增动效层：选区工具栏弹出及按钮依次淡入、对话菜单下拉、侧栏面板切换、批注条目错峰入场、
AI 消息入场与闪烁光标、对话框弹性弹出、按钮按压回弹、主题切换颜色平滑过渡；均遵循 `prefers-reduced-motion`。

`node --test`：115 项，113 通过，0 失败，2 跳过。

## 0.17.0 阅读器布局重设计

起因：用户反馈阅读器布局不合理、不好看（截图：两条工具栏叠放，「页面」标签下错误出现批注列表，缩略图被挤压）。

- 修复：0.16.5 的 `.annotation-panel-wrap { display: grid }` 覆盖了 `.sidebar-panel` 的隐藏规则，批注筛选和列表在任何标签下都显示。
- 顶栏合并：侧栏开关、文档标题、翻译分段按钮、工具按钮和醒目的「AI 助手」放在同一条 52px 毛玻璃顶栏；网址输入框只在空状态显示。
- 翻页/缩放移到页面底部的悬浮胶囊（`#documentBar` 现为 `.reader-dock`，id 不变）。
- 自动适应宽度：打开文档时自动适配，最大 130%；侧栏或 AI 面板开合、窗口尺寸变化时用 ResizeObserver 重新适配；点击百分比可在「适应宽度」和 100% 间切换；手动缩放会退出自动适配。
- 缩放时先锁定当前页再重排，并用 `instant` 滚动，修复缩放后页面漂到第 1 页。
- 侧栏：分段式标签、更大的缩略图（页码用胶囊标出）、批注卡片（左侧色条，编辑/删除悬停才显示）、圆形颜色筛选。
- 主题：补上 workspace-ui.css 写死浅色的覆盖（深色下 AI 面板头部和输入区原为白底）。
- `tests/pdf-reader-preview.html` 按新结构重新生成。

验证：内置浏览器加载 `tests/pdf-reader-preview.html` 和真实 PDF（73 页），检查了浅色/深色主题、批注标签、AI 面板开合（页码保持第 8 页，缩放 80%→50%→80%）。
`node --test`：115 项，113 通过，0 失败，2 跳过。

## 0.18.0 侧边栏与划词浮窗对照 Reader 重做

参考 cynicalight/reader（apps/web/src/style.css、papers/PaperLibrary.tsx）的设计令牌与组件细节。

- 新增 `sidepanel-refresh.css`（在 workspace-ui.css 之后加载）：中性灰阶表面、近黑主按钮、主题色仅用于状态；悬停 4% 前景淡染；10px 圆角。
- 顶栏 48px 毛玻璃；标签改为分段控件，白色指示块滑动切换（纯 CSS `:has`）。
- 查词空状态换为 Reader 式倾斜双卡片插图；结果卡、上下文、自动收录提示改为低对比层级。
- 词库：卡片改为列表行；删除/查看记录浮在右上角，悬停才出现，不占布局。
- 文献库：统计改为可点击的状态筛选标签（新增「未读」），隐藏原状态下拉框（保留在 DOM 中供筛选逻辑使用）；标题可直接点开阅读；索引/补全/编辑/删除收进「⋯」菜单（带文字，Esc 或点外部关闭）；来源与索引状态合并为一行。
- 主题：新增 `theme-sync.js`，侧边栏跟随阅读器的浅色/纸张/深色设置并实时同步；纸张与石墨深色取自 Reader 配色。
- 提示条改为底部居中胶囊；设置与文献对话框、开关、诊断区跟随主题。
- 划词浮窗（content.css）换为中性白色弹层与近黑按钮。
- 预览夹具 `tests/preview.html` 按当前结构重新生成，`preview-mocks.js` 增加 4 条示例文献；支持 `?tab=`、`?theme=`、`?settings`、`?menu` 参数。
- 新增 `tests/sidepanel-refresh.test.cjs`。`node --test`：118 项，116 通过，0 失败，2 跳过。
- 在内置浏览器中以 390px 宽查看：浅色查词/词库、纸张词库/文献库、深色查词/设置/文献「⋯」菜单。未在真实 Chrome 扩展侧边栏中查看；划词浮窗未渲染验证。

## 0.18.1 主按钮恢复绿色

- 用户更喜欢原来的绿色：三套主题的主按钮、品牌标、选中的筛选标签、开关改回绿色（浅色/纸张 #216652，深色 #5fb39a 配深色文字）；纸张主题的强调色也从陶土色改回绿色。
- 选中的模型方案卡片改为绿色描边；提示条保持深色中性。
- 划词浮窗的按钮、气泡、加载圈和译文颜色恢复绿色，其余保留中性白色弹层。

## 0.19.0 功能与交互补全

参考 Reader / Zotero / Chrome PDF / Anki 的常见能力，补齐缺口：

- **PDF 文档内查找**（新模块 `pdf-find.js`）：⌘/Ctrl+F 打开查找栏（选中文字时自动填入），Enter / Shift+Enter 或 ⌘G 跳转，「Aa」区分大小写，Esc 关闭；顶栏新增查找按钮。逐页扫描文字并显示「当前/总数」，扫描中先跳到当前页之后的第一个匹配。高亮使用 CSS Custom Highlight API，不改动文字层 DOM，不影响划词和批注选区；查询中的空格可匹配 PDF 换行处丢失的空格。缩放（含自动适应宽度）打断渲染时，等页面重绘完成后再定位。
- 修复：阅读器外层 `.document-shell` 在查找栏聚焦时被浏览器横向滚动 16px，导致侧栏被推出视口；改为 `overflow: clip`。
- **撤销删除词条**：删除后提示条带「撤销」按钮（6 秒），后台新增 `restore` 动作，按原位置放回快照；期间重新查过同一个词则拒绝覆盖。
- **复习快捷键**：空格/回车显示答案，1/2/3 评分；按钮上显示按键提示。
- **查词页「最近查过」**：空状态下显示最近 8 个词，点一下重新翻译。
- **文献库「继续阅读」卡片**：未筛选时置顶最近在读的一篇，显示页码、进度和时间。
- **拖放导入**：把 PDF 拖进侧边栏任意位置即可加入文献库（显示虚线遮罩）。
- 测试：新增 `tests/pdf-find.test.cjs`（5 项）和后台恢复测试（1 项）。`node --test`：124 项，122 通过，0 失败，2 跳过。
- 浏览器核验（内置浏览器 + 本地预览夹具）：
  - 查找：73 页 PDF 搜索「Euclid」共 6 处，计数 1/6→4/6 正确跳转到第 12 页；第 1 页当前匹配有橙色高亮。环境限制：该浏览器在后台不触发 requestAnimationFrame，pdf.js 页面渲染挂起，后续页面的「当前匹配」高亮与滚动定位未能目视确认。
  - 侧边栏（读 DOM）：最近查过显示 2 个词；继续阅读卡片内容正确；未读计数 1；复习页空格显示答案；删除词条后提示条出现「撤销」按钮。点击「撤销」未能在提示条 6 秒内点到（浏览器每步操作约十几秒），恢复逻辑由后台单元测试覆盖。
  - 拖放导入、⌘F 快捷键未在浏览器中实际触发。
- 预览夹具：`tests/pdf-reader-preview-mocks.js` 支持 `?find=…&findSteps=N` 自动化；`tests/preview-mocks.js` 支持词条删除/恢复；两个预览页按当前结构重新生成。

## 0.20.0 PDF 翻译排版重写 + 主题/对话框动效

### PDF 翻译排版
- 根因：原算法逐行翻译、逐行摆放——句子被行尾截断，中英文长度差导致字号估算失准（挤小或溢出），双栏论文中两栏同一高度的行会被拼到一起、跨栏覆盖。
- 新算法 `LexiLoopPdfLayout.buildTranslationBlocks`：行 → 段落。按字号相近、行距连续、同栏横向重叠、左对齐/首行缩进合并；短行以句末标点结束视为段落结束；编号小节标题、图注/表注独立成段；行尾连字符断词拼回（learn- + ing）。
- 栏识别：统计全页的段起点与段右边界，出现 3 次以上的视为栏边界，阻止跨栏合并；只出现一两次的大间距（行内公式）并回同一行。
- 不翻译、保留原样：旋转文字（arXiv 侧边水印）、表格行（一行切成 4 段以上）、插图内小字/图例（字号明显小于正文的短文本、多行但每行一两个词）、公式（含运算符且几乎无自然语言词）。
- 渲染：译文块覆盖整个段落框，按实际 DOM 测量二分缩小字号直到不溢出；行距贴近原文；译文页不可见时先估算，显示后自动按实测重排。
- 后台：PDF 批量翻译单段上限从 500 放宽到 2000 字符（原先长段落后半截会被截断）。
- 验证：
  - 下载 ResNet（CVPR 双栏）与 Transformer（NeurIPS 单栏）两篇 arXiv 论文，在内置浏览器预览夹具中开启全文翻译。译文使用按 0.55 字/字符比例生成的模拟中文（未调用真实翻译服务）。
  - ResNet 全部 12 页、216 个段落块：溢出 0、重叠 0；正文字号中位数约 8pt（原文 10pt）。修正前第 2、7、10、11 页共 14 处跨栏重叠，第 8 页 3 处溢出。
  - 两篇论文前 4 页离线复核：重叠 0、跨栏 0。
  - 新增 3 项排版单元测试。`node --test`：127 项，125 通过，0 失败，2 跳过。
- 未验证：真实翻译服务的译文长度与质量；扫描版 PDF；竖排、多于两栏的版式。

### 动效
- 新增 `motion.js` / `motion.css`（阅读器与侧边栏共用）。
- 主题切换：View Transitions API，新主题从屏幕中心圆形展开（560ms）；不支持或开启「减少动态效果」时退回颜色渐变/直接切换。
- 侧边栏顶栏新增主题按钮；侧边栏与阅读器的主题双向实时同步（同源 localStorage + storage 事件），对方也用展开动画切换。
- 对话框（设置、文献编辑/导入/索引、批注、知识页）：从中心缩放 + 去模糊展开（弹性曲线 420ms），关闭时快速收拢；遮罩渐入并模糊背景。使用 `@starting-style` 与 `transition-behavior: allow-discrete`，替换原先 3 处互相覆盖的关键帧动画。
- 验证（内置浏览器 + 侧边栏预览）：点击主题按钮浅色→纸张→深色均切换成功；埋点确认动画在 `::view-transition-new(root)` 上以 clip-path 从 `circle(0)` 展开到覆盖全屏的半径；设置弹窗计算样式为新的过渡（无关键帧动画），遮罩 28% 黑 + 4px 模糊。动画过程本身未录屏目视。

## 0.21.0 原文 / 译文对照阅读（参考 Reader）

### 对照 Reader 找到的主要差距
Reader 的 PDF 翻译不是把译文盖在原版面上，而是左边原文 PDF、右边按段落重排的译文阅读栏，两栏滚动对齐、段落悬停联动。LexiLoop 之前只有「全文翻译」：两页版面并排、译文压在原段落框里，字号常被缩到 7–8pt，长段落难读。

### 改动
- 顶栏「全文翻译」改为三段切换：仅原文 / 原文译文 / 仅译文（滑块动画，支持方向键），旁边显示翻译进度（翻译中 3/12、翻译完成、x 页失败）。
- 译文栏（新模块 `pdf-bilingual.js`）：按页分节、按段落重排；区分大标题、小节标题、图注、正文；双栏论文按先左栏后右栏排序（`LexiLoopPdfLayout.orderBlocksForReading`）；文献引用编号 [12] 着色；未翻译的页显示骨架屏，失败的页可单独重试。
- 两栏对齐：以视口 38% 处为基准线，按「段落 + 段内位置」对齐；只有用户正在操作的那一栏会带动另一栏，避免来回触发；双栏页面横向参考鼠标所在的栏；滚到顶部/底部时两栏一起到头。
- 悬停联动：鼠标在原文段落上时，译文对应段落高亮，原文被框出；悬停译文段落时出现工具条（定位原文 / 复制译文 / 复制原文 / 问 AI）；在对照模式点击译文段落，原文平滑滚到该段并闪烁。
- 分隔条可拖动（25%–75%），双击恢复一半，支持方向键；中间按钮交换左右；分栏比例、左右顺序、译文字号存在本地并在下次打开时恢复。
- 仅译文模式下，底部胶囊的 −/＋ 调译文字号（13–24px），⌘F 交给浏览器原生查找译文；切换模式、调字号时保持正在读的段落不跳。
- 翻译按需排队：从当前页开始，就近优先、先往后翻；切回仅原文时暂停，已译好的页保留；连续两页失败时暂停并提示。
- 原有的版面覆盖式「本页翻译」改名「版面对照」，只在仅原文模式下出现。
- 缩放时保持页内位置（以前只保持在同一页的顶部）。
- 插图里的零散标签（如 relu、weight layer）不再作为段落翻译。

### 验证
- `node --test`：137 项，135 通过，0 失败，2 跳过。新增 `tests/pdf-bilingual.test.cjs`（模式与分栏取值、引用编号转义、坐标找段落、翻译排队顺序、双栏阅读顺序、段落类型、插图标签过滤、页面结构）。
- 在内置浏览器用 ResNet 论文（arXiv 1512.03385v1，双栏，12 页）和带原文标记的模拟中文实测：
  - 第 1、3 页段落顺序正确：标题 → 作者 → 摘要 → 引言（左栏）→ 右栏各段。
  - 点「下一页」后原文滚到第 2 页，基准线处原文是「In this paper, we address…」段内 36% 处，译文栏同一段同一位置。
  - 鼠标悬停原文摘要：译文摘要段高亮，原文框出摘要段。
  - 点击译文「The formulation of F(x)」段：原文定位并框出该段。
  - 切到仅译文、字号 16→17px、再切回对照、交换左右：两栏都仍停在第 2 页第 6 段。
  - 深色主题、版面对照、打开 AI 面板的三栏布局都正常。
- 未验证：真实翻译服务返回的译文效果；在你的 Chrome 扩展环境中实际使用；拖动分隔条（预览工具无法拖拽，逻辑与 AI 面板宽度拖动相同）。

## 0.22.0 断句、超链接、插图公式修复 + 链接预览与返回

### 用户反馈的三个问题
1. **一句话被拆成两段翻译**（截图：列表项「• Show-Harness demonstrates … for / zero-shot control, …」）
   - 根因：列表项、编号参考文献是悬挂缩进，续行比带「•」「[1]」的首行更靠右，旧规则把右移的续行当成新段落首行。
   - 修复：识别列表标记，允许悬挂缩进；续行按第二行的左边界对齐判断。另外加了「断句接续」：段落没有以句末标点结束、下一段以小写开头时（换栏、跨插图、跨页），合并成一句翻译，阅读栏显示整句；版面对照按比例拆回各段原位置。
2. **译文没有超链接**
   - 原文页之前也没有链接层（未调用 `getAnnotations`），现在两边都有。
   - 原文：PDF 链接注释生成可点击区域；外部链接新标签页打开，内部链接（引用、图表、章节）跳转。
   - 译文：按锚文本在译文中找回位置——引用编号、图表/章节/公式编号、网址原样保留；找不到位置的外部链接附在段末成小标签。只放行 http(s)/mailto。
3. **译文丢了图片和公式**
   - 新模块 `pdf-figures.js`：低分辨率渲染页面，去掉已翻译的文字段落、旋转水印、页眉页脚，剩下的墨迹连通区域即插图/独立公式；三线表按横线 + 「Table N」标题整块识别；正文框（带底色的摘要框）不误判。
   - 插图按原文 3 倍分辨率裁成图片，按阅读顺序插入译文栏，大小随译文字号等比缩放；公式与文字同高。插图内的文字（说明框、标签）不再单独翻译。

### 继续参照 Reader 补的功能
- 内部链接悬停预览：参考文献条目原文（已翻译的显示译文）、指向插图时显示图片，带「跳转」按钮。
- 跳转后左下角出现「返回第 N 页」，回到跳转前读到的位置。
- 插图悬停工具条：定位原文 / 放大 / 复制图片 / 让 AI 解释这张图；点击插图从原位置放大到屏幕中央（再按屏幕尺寸换成更清晰的版本）。
- 程序滚动改成自己的缓出动画（参考 Reader 的 `animatePDFScroll`），长距离跳转不会停在半路；用户滚动时立即停下。
- 脚注单独识别，短脚注（* Equal contribution）也翻译。

### 验证
- `node --test`：151 项，149 通过，0 失败，2 跳过。新增 `tests/pdf-figures.test.cjs`（插图区域、正文框、三线表、图内文字、悬挂缩进、编号参考文献、断句接续、脚注、锚文本截取与对齐、译文链接与转义、合并句拆分、链接目标段落）。
- 内置浏览器用 Show-Harness（arXiv 2609.10522v1，30 页）实测，译文为带原文标记的模拟中文：
  - 截图中的列表项现在是完整一段；第 1 页摘要被插图隔开的后半句接回同一句；第 3→4 页跨页的半句接到第 3 页。
  - 插图：第 1 页图 1、第 2 页图 2、第 5 页架构图、第 7 页表 1（整块）、第 5/6/8/9 页独立公式都出现在译文栏；页眉 Logo、摘要底色框不再误判。
  - 链接：第 2 页 16 个引用链接锚文本全部正确（24、40、82、97…）；悬停 [24] 预览出第 19 页「[24] Danny Driess … PaLM-E」；点击跳到第 19 页并框出该条目，「返回第 2 页」回到原位。
- 未验证：真实翻译服务的译文（引用编号是否保留取决于模型）；扫描版 PDF；在你的 Chrome 扩展环境中实际使用。

## 0.22.1 译文超链接错位 / 丢失修复

### 问题
- 用户截图：引用编号全部堆在段末。截图来自测试预览页的模拟翻译（模拟器把编号拼在段末），但真实翻译也有同类风险：0.22.0 靠「翻译服务保留编号 → 按编号找回链接」，翻译服务改写或丢掉编号时，链接被挂到段末小标签。
### 修复：占位符保护（新模块 `pdf-inline.js`）
- 翻译前把引用组 `[24, 40, 82, 97]`、图表/章节/公式/附录等编号（Figure 3、Sec. 3.2、Eq. (2)、Appendix A，含 Sections 3 and 4 这类列表）、网址/DOI、其它带超链接的文字（作者-年份引用、模型名等）整体替换成 `{v1}{v2}…`，翻译服务只决定位置。
- 翻译后从原文放回：内容不会被改写或丢失；引用组里每个编号各自挂上对应的 PDF 链接；编号在中文译文里写成「图 3」「第 3.2 节」「式 (2)」「附录 A」。
- 占位符被翻译服务弄丢时，按它在原文中的相对位置补回到最近的标点前；兼容 `{V1}`、`{ v1 }`、全角括号；重复的只保留一次。不再有段末小标签。
- 链接位置：段落算法记录每行在段落文字中的起止位置，PDF 链接框按「所在行 + 横向比例」换算成字符位置；同一组引用里按链接框先后顺序对应编号（修正锚文本把 92 认成 76 的情况）；跨页接上的后半句也带上下一页的链接。
- AI 翻译（OpenAI 兼容 / Anthropic）的系统提示词加了「占位符原样保留」的要求；Google / MyMemory 实测会原样保留。
- 引用悬停预览：参考文献条目跨栏时接成整条，显示上限由 520 字放宽到 1600 字。
### 验证
- `node --test`：159 项，157 通过，0 失败，2 跳过。新增 `tests/pdf-inline.test.cjs`（9 项：保护、放回、链接、丢失补回、改写容错、名称链接、安全转义、失败回退、编号列表、同组顺序对应）。
- 真实 Google 翻译（node 直连 + 内置浏览器预览 `?mockzh=google`，Show-Harness 第 1–5 页）：
  - 第 1–3 页 20 个占位符全部原样带回，正文无残留 `{v…}`。
  - 第 2 页 16 个 PDF 引用链接全部在译文原句位置可点（含此前漏掉的 92）；「如 图 2 所示」可点。
  - 悬停译文中的 [24]：预览出第 19 页完整条目及译文。
- 未验证：Anthropic Claude 等 AI 翻译服务的实际输出（提示词已要求保留占位符）；在你的 Chrome 扩展中实际使用。

## 0.23.0 模型连接：自定义 API、Responses、ChatGPT 订阅、CC Switch 导入

- 设置里的两张固定方案卡片改成连接列表。原方案和Anthropic 兼容服务 仍在，可以再加 OpenAI、Anthropic、Responses、DeepSeek、Gemini 或空白自定义连接。每套连接单独保存密钥。
- 接口协议增加 OpenAI Responses。请求使用 `instructions` + `input`，`store: false`，不把 PDF 内容存到服务端。
- 「订阅登录」添加 ChatGPT / Codex 连接，沿用现有本地 OAuth 辅助程序，只用于 PDF AI。Grok、Antigravity 的订阅登录没有接进扩展；这两家如果在 CC Switch 里是 API Key，可以导入。
- 「从 CC Switch 导入」只读本机 `~/.cc-switch/cc-switch.db`。官方空配置和没有 API Key 的订阅账号会标为不可导入，不读取 OAuth 凭据。辅助程序还没更新时，可以选择数据库文件导入。导入不会切换当前正在用的连接。
- 阅读器侧栏在页面/大纲/批注/生词下面增加词库、复习、文献入口，点击打开扩展侧边栏对应页。词库、复习、文献没有删除。
- 触控板捏合仍按手势比例缩放，停手后重绘；捏合过程中禁用页面内指针事件，避免文字层抢事件。
- `node --test`：196 项，194 通过，0 失败，2 跳过。未在你的 Chrome 里点过导入和订阅登录。CC Switch 导入的真实密钥没有写入代码或验证记录。

## 0.23.1 Grok 订阅登录

- 设置里「订阅登录」现在可选 ChatGPT 或 Grok。Grok 走 xAI 设备码：打开 `https://auth.x.ai`，在页面填入扩展显示的代码。协议与 CC Switch 的 xAI OAuth 相同（发现文档、公开的 Grok CLI client id、`api.x.ai/v1/responses`），实现在 `native/xai-oauth.cjs`，没有复制 CC Switch 的代理代码。
- 凭据只写在 `~/Library/Application Support/LexiLoop/xai/auth.json`（权限 600）。不读取 CC Switch 的 `xai_oauth_auth.json`，也不读取 Grok CLI 的 `~/.grok/auth.json`。
- Grok 请求不依赖 Codex CLI。ChatGPT 登录仍走原来的辅助程序。授权地址只允许 `https://auth.x.ai` 或 `https://auth.openai.com`。
- 未在真实 Chrome 里完成一次 Grok 登录。`node --test`：204 项，202 通过，0 失败，2 跳过。新增测试覆盖端点校验、设备码、拒绝保存没有 refresh token 的结果、失效后续期，以及 PDF AI 按 `provider: grok` 路由。

## 0.23.2 订阅连接同时用于翻译，并可选推理强度

- 当前连接是 ChatGPT 或 Grok 订阅时，划词翻译、PDF 翻译和「测试翻译」都走订阅登录，不再报「尚未设置 API Key」。单词仍先查有道词典，句子和 PDF 段落走订阅。
- PDF 翻译按每 12 段合并成一次订阅请求，避免一页打出几十次请求。合并结果对不上时，退回逐段翻译。
- 设置里增加「推理强度」：默认 / 低 / 中 / 高 / 极高。订阅和 Responses 请求写入 `reasoning.effort`；OpenAI 兼容请求写入 `reasoning_effort`。Grok 没有极高，会按高发送。没选时不额外指定。
- 「加载模型列表」改为可见下拉框。Grok 在线列表失败时仍给出 grok-4.7 / 4.6 / 4.5 / 4.3，并显示失败原因。图片和视频模型不进入列表。
- `node --test`：208 项，206 通过，0 失败，2 跳过。未在 Chrome 里用真实订阅再点一次翻译和模型列表。

## 0.23.3 翻译和 AI 可以各选一条连接

- 设置顶部增加「翻译使用」和「AI 使用」。两条都可以选已保存的 API 连接或订阅登录，改下拉框立即生效。
- 划词、PDF 翻译走翻译那条；PDF 里的 AI 对话走 AI 那条。保存正在编辑的连接不会把两条选择一起改掉。
- 没单独选过时，两条都还是当前正在用的连接，所以旧配置不会突然拆开。
- 删除某条连接后，指着它的选择会回到仍启用的连接。
- `node --test`：209 项，207 通过，0 失败，2 跳过。未在 Chrome 里用真实 DeepSeek 和 Grok 各点一次。

## 0.24.1 插图整张裁切、暂停与只翻本页，修复打开 PDF 失败

- **阻断性 bug**：`aiAbortController` 夹在函数之间声明，打开/关闭文档的清理路径先读它，抛 `Cannot access 'aiAbortController' before initialization`，打开任意 PDF 直接失败。已把 9 处散落的顶层状态声明全部移到 `initialize()` 之前。新增回归测试：`initialize();` 之后不允许出现顶层 `let`/`const`，并已用临时副本验证测试能抓到该问题。
- **插图**：改为从 pdf.js 操作符取图片对象矩形（`paintImageXObject` / `paintInlineImageXObject`，处理 `save`/`restore`/`transform` 的 CTM），再与墨迹区域按 gap 合并；合并会带进大片正文时（覆盖率 > 0.42）不合并。
- **实测**（Show-Harness，30 页，真实 Google 翻译，内置浏览器 + 预览页）：
  - 第 1 页照片为完整的 1392×732 一张；全文 19 张插图均为完整宽幅比例（约 1.8–2.0），不再出现「机械臂 + 标签」碎片。
  - 翻译中暂停 → 按钮变「继续」，提示「翻译已暂停」，状态显示「已暂停 2/30」。
  - 点「只翻第 1 页」→ 提示「第 1 页已经翻译过，后续已暂停」，后续页面保持「等待翻译」。
  - 全部译完后两个按钮自动隐藏（设计如此）。
- **测试设施**：预览页改由 `scripts/build-reader-preview.cjs` 从 `pdf-reader.html` 生成；此前手工维护已漂移（缺 `pdf-zoom.js`、`reader-center.js`、缺两个翻译按钮、旧顶栏）。新增 `tests/preview-parity.test.cjs` 校验 id 与脚本包含关系。预览桩 `window.chrome` 改用 `defineProperty`；脚本错误累积到 `<html data-preview-errors>`。
- **排查中确认的两个环境问题（不是产品 bug）**：Python `TCPServer` 单线程会让页面 20 多个脚本并发加载被串行阻塞，部分脚本被浏览器中止且无任何报错——已改用 `ThreadingTCPServer`；预览桩直接用 `window.chrome = {...}` 会被原生对象吞掉。
- `node --test`：225 项，223 通过，0 失败，2 跳过（新增 5 项：图片块裁切 4 项、预览页一致性 1 项；此外新增初始化顺序回归 1 项，并入既有文件）。
- **未在真实 Chrome 扩展里验证**；真实译文由 Google 翻译提供，未测 AI 翻译服务对插图场景的表现。

## 0.24.2 原文点击也能定位译文

- 新增 `handleSourceClick` / `focusTranslationBlock`：在原文页点击一段，译文栏滚到对应段落（`translationTargetFor`，整句跨栏/跨页时落到开头那段），并加 `is-linked` 高亮 + `is-flash` 闪烁；原文用 `sourceBoxesFor` 框出整句。
- 不触发定位的情况：拖选超过 6px、选区非空、点 `.pdf-link` / 批注标记 / 选区工具条 / 截图层、`pdfCaptureMode` 开启、非 parallel 模式、点击落在段落之外。
- 修复反向同步：原文栏在点击后抖动 1px 会触发 `handleDocumentScroll` → `syncTranslationToSource`，把刚定位好的译文拽回原处。新增 `translationFocusLockUntil`（700ms）在定位期间暂停这条同步。
- 译文栏滚动改为原生 `scrollTo({behavior:"smooth"})`，距离超过 1.2 屏时直接 `instant`；不再依赖主线程 rAF（预览环境里 rAF 只推进一帧，实测滚动停在 +14px）。
- 修掉 `flashTranslationNode` 的同名重复定义：旧实现只加 `is-flash` 不移除，且后定义的旧函数覆盖了新实现。
- 实测（内置浏览器 + `tests/pdf-reader-preview.html`，WAM-Nav 21 页论文，模拟中文译文）：第 4 页点击正文 `The visual memory is then residual…`（y=421），译文栏 `paneTop` 14230→15966，目标块 `4:t8` 从视口外滚到 `top=137`（块内 88% 落在 38% 阅读线），原文框 `(307,410,201×14)` 与点击位置重合；1.5 秒后仍保持，未被拉回。点击前译文显示 [3.2] 段落，点击后显示 `where σ is the` 段落，截图为证。
- 未验证：拖选文字时的手感（浏览器工具不支持拖拽）、在你的 Chrome 扩展里实际点击。
- `node --test`：226 项，224 通过，0 失败，2 跳过。新增断言覆盖原文点击绑定、四类保护条件与同步锁。

## 0.25.0 多语言目标与连接列表重排

### 目标语言
- `background.js`：新增 `TARGET_LANGUAGES`、`resolveTarget(original, requestedTarget, preferred)`、`preferredTargetLanguage()`（带缓存，`storage.onChanged` 失效）。`translate()` 与 `translatePdfBatchTexts()` 都取设置里的目标语言；`translatePdfBatchWithSubscription()` 按目标语言分组。
- 目标语言不是 `zh*` 时跳过有道词典分支（有道只做中英互译）。
- `sidepanel.html` / `sidepanel.js`：新增 `#targetLanguageSelect`，改动即时写存储；`saveSettings()` 改为展开 `...settings`，否则点开关会把语言设置清掉。

### 连接列表
- `translation-providers.js`：`normalizeMeta()` 在没有 meta 时 `added` 为空；`publicProfileSettings().connections` 由 `hasConnectionSetup()` 过滤——内置连接要有密钥或保存过配置才显示；`profiles` 仍保留内置记录供迁移与旧接口读取。
- `removeConnection()` 允许删除内置连接，删除时保留其密钥；删除最后一条连接时 `next` 回落到 `DEFAULT_CONFIG`。
- `getRoleSettings()`：没有连接时翻译返回内置配置（`textProvider: automatic` → MyMemory / Google），AI 直接抛「还没有添加模型连接」。
- 修复 `getProfileStore()` 把存储里的 `original` / `c_anthropic1` 键当作用户新增连接反复收进 `added`（导致删掉的内置连接又出现、并在无连接时错误选中该配置）。
- `originalAvailable` 改为只认 `saved.originalAvailable === true`；默认配置的 `providerProfile` 恰好是 `original`，不能再据此当成已配置。
- `sidepanel.js`：`connectionOrder` 初始为空；角色下拉在没有连接时显示禁用的「未选择」，徽章显示「未连接」；连接行空状态 `#connectionEmpty`；新增「添加连接 → Anthropic 兼容服务」的快速入口。

### 界面
- 设置顶部改为「模型 / 偏好 / 数据」分段（`#settingsNav` + `[data-settings-pane]`），打开设置时恢复上次分区。
- 视觉精修层追加在 `sidepanel-refresh.css` 末尾：标签分段控件的滑块阴影、输入框 42px + 聚焦柔光环、空状态垂直居中、分区标题小号字距 + 分隔线、连接行悬停底色、词库条目极淡分隔。三套主题共用变量。

### 验证
- `node --test`：**232 项，230 通过，0 失败**，2 跳过。新增：
  - `translation target language follows the setting instead of always swapping Chinese and English`
  - `without any saved connection translation still works and PDF AI asks for one`
  - `a built-in connection only shows up after it is actually configured`
  - `upgrading an old install keeps a configured built-in connection but drops the untouched one`
- 内置浏览器（`tests/preview.html`，390px 侧边栏）实测：
  - 设置「模型」页显示空状态「还没有模型连接」+ 实心「＋ 添加连接」；「翻译使用 / AI 使用」为禁用的「未选择」。
  - 「＋ 添加连接」展开四项，点「Anthropic 兼容服务」进入详情：名称、`https://api.example.com/v1/messages`、API 格式 Anthropic、模型 `claude-sonnet-5-5` 均已预填。
  - 「偏好」「数据」两页切换正常，`disabled` 开关与备份按钮都在。
  - 深色主题下分段导航、下拉、空状态、主按钮对比正常；词库页条目分隔可见。
- 未验证：真实 Chrome 扩展里的语言切换效果、真实翻译服务在日语/德语等目标下的输出质量。

## 0.25.1（2026-10-26）查词结果补回音标、词性与释义

### 根因
- React 侧栏重写时读错了字段：`WordsPage.jsx` 用 `word.phonetic`，真实结构是 `phonetics: { uk, us, generic }`；`LookupPage.jsx` 用 `result.engine`，真实字段是 `service`。
- 有道返回的 `meanings`（词性分组 + 释义）与 `audio`（英/美真人音频）都没有渲染，所以查词只剩一行译文。

### 改动
- `ui/src/lib/pronounce.js`（新增）：`canSpeak`、`audioUrlOf`、`speak`、`stopSpeaking`，行为对齐旧版 `sidepanel.js`。
- `ui/src/lib/format.js`：新增 `trimSlashes`、`formatPhonetics`（英 /x/ 美 /y/，都没有时回落 generic）、`meaningSummary`。
- `ui/src/components/ui.jsx`：新增 `SpeakButton`。
- `ui/src/pages/LookupPage.jsx`：结果卡改为词典式（原形 + 音标 + 词性释义 + 发音 + 引擎 + 次数）；`recorded === false` 时显示「整句翻译不记入词库」；最近查过列表也带音标。
- `ui/src/pages/WordsPage.jsx`：音标改用 `formatPhonetics(word.phonetics)`，释义用 `meaningSummary`，悬停操作组新增发音。
- `ui/src/lib/bridge.js` / `demo.js`：预览演示返回词典结构；演示词条改成 `phonetics` 对象。

### 验证
- `node --test`：**238 项，236 通过，0 失败**，2 跳过。
- 新增 `tests/lookup-fields.test.cjs`（5 项）：查词页字段、词库音标字段、整句不声称收录、`formatPhonetics` 输出、`meaningSummary` 输出。
- 迁移 3 条旧侧栏断言到新界面（`workspace-ui.test.cjs`、`sidepanel-refresh.test.cjs`、`ui-shell.test.cjs`）。
- 内置浏览器（`ui-dist/index.html?frame=380`）实测：
  - 深色主题查 `attention`：结果卡显示 `attention` / `美 /əˈtenʃn/` / `n. 注意力；关注` / `有道词典` / `已收录到词库 · 21 次`，并有发音按钮。
  - 词库页 5 条均显示音标与词典释义（`embedding 美 /ɪmˈbedɪŋ/ 嵌入；嵌入向量 12 次`），悬停出现播放/重查/删除。
  - 浅色主题下词库列表排版正常。
- 未验证：真实扩展里点击发音（预览环境的音频会被浏览器策略拦截并回落到系统朗读）；真实有道同时返回英/美音标时的并排显示。

## 0.26.0（2026-10-26）

### 修掉「文献打不开」的真实根因
- `ui/src/lib/bridge.js` 的 `openReader()` 发的是 `{ paperId }`，而 `background.js` 第 383 行起的 `OPEN_PDF_READER` 只读 `message.libraryId`。
- 后台取不到 id 时 `requestedUrl` 回落到 `sender.tab?.url`，于是用侧边栏所在网页的地址开阅读器 —— 这才是「点了没反应/打不开文献」的原因，不是阅读器本身坏了。
- 现在发送 `libraryId`，并带上 `page`（上次读到的页码）。新增测试断言消息字段，防止再次写错。

### 桌面验证（内置浏览器，真实侧边栏宽度 380px）
- 词库收起态：5 行连续列表，每行 单词 + 音标 + 一组释义摘要 + 时间 + 次数，左箭头指示可展开。
- 点 `embedding` 展开：`n. 嵌入；嵌入向量` / `v. 嵌入；使插入`、`查过 12 次`、3 条查询记录（`Show-Harness … 第 4 页`、`Deep Residual Learning … 第 7 页 · arxiv.org`、`arxiv.org`），底部「重新查词 / 下次复习 / 删除」。
- 修的过程中发现并改掉：收起态两组释义拼成「嵌入；嵌入向量；嵌入；使插入」（改为一组）、来源标题被 meta 挤断（改为两行）、标题退化后域名重复显示、展开态右上角操作被鼠标移开就消失（改为常显）。
- 继续阅读显示 `NaN%`：`percent()` 返回的是 `"34%"` 字符串，`Math.round()` 得到 NaN。改为用数值计算。
- 文献库：`4 篇 / 全部4 未读1 在读1 已读2 收藏2`，连续行布局，深色与浅色都核对过；收藏金标与百分比不再重叠。
- 深色主题主色确认生效：`--primary` 计算值为 `#4d9b85`，`.btn-primary` 背景 `rgb(77, 155, 133)`。

### 测试
- `node --test tests`：245 项，243 通过，0 失败，2 跳过。
- 新增 `tests/ui-interactions.test.cjs` 7 项：`libraryId` 契约、`openWordSource` 参数、词库主点击为展开、展开过渡与 `prefers-reduced-motion`、继续阅读进度为数值、文献库列表为连续行。

### 未验证
- 没有在你的 Chrome 扩展里真正点开一篇文献（预览环境 `openReader` 直接返回 `ok:true`，不会真的开标签页）。修复依据是消息契约定配对，需要你重载扩展后点一次确认。
- 没有在真实扩展里点词库记录跳原文。
