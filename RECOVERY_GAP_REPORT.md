# Meetfolio v0.1 → v0.6.0｜更新历程、源码差异与增量重建审计

## Phase 3A 原生链路（2026-10-29）

从 Phase 2 的已验证提交 `72aee93` 独立建立开发分支。已修复启动竞争、采集失败后的资源释放、44.1/48 kHz 采样位置漂移、未确认推理积压检测和重放连接清理，并增加缓存文件摘要与不含访谈内容的有界诊断日志。Windows 本地已有真实 Electron/Preload/原生模块加载及公开测试音频识别证据；未签名安装器仅完成构建/静态检查，没有安装到日常目录。详情见 [审计](docs/engineering/PHASE3A_AUDIT.md) 与 [Windows 验收清单](docs/engineering/PHASE3A_WINDOWS_ACCEPTANCE.md)。

物理麦克风、纯中文/纯英文各 30 秒、实际断网、10/30 分钟稳定性、安装/卸载生命周期仍为 **Not verified**。WAV 持久录音、逐句回放等缺口仍在 Phase 3B 范围；不得以文件音频测试或新 CI 代替真实设备验收。

## Phase 2 工程状态（2026-10-28）

以下结果是 Windows、本地 Node 22.23.4 / npm 11.19.0 的检查，不能替代 GitHub Actions 或真实桌面验收：

| 检查 | 状态与范围 |
| --- | --- |
| `npm ci`、`npm run verify` | 通过；npm 11 提示部分依赖安装脚本未经批准，原生打包未验证 |
| Web / Desktop 单元测试 | 分别 30 / 30、11 / 11 通过 |
| Desktop Playwright | 10 / 10 通过；包含浏览器和模拟桌面桥接，不是真实 X-ASR / 麦克风验收 |
| Server PostgreSQL 测试、历史 Web E2E | 本机阻塞：PostgreSQL 不可用，Docker 存储 I/O 错误；CI 已配置隔离 PostgreSQL，结果须以实际运行记录为准 |
| 生产依赖审计 | 失败：4 high、2 moderate；部分修复需要破坏性依赖升级，需单独评估兼容性 |
| Windows 安装器、macOS、真实设备 | 未运行 |

GitHub Actions run `40718812762`（提交 `2c9fc29`）中，隔离 PostgreSQL 的 119 项服务端测试连续两轮通过，Linux Desktop 浏览器作业通过；生产依赖审计失败。历史 Web E2E 为 30 通过、3 失败，失败均为桌面入口的过期中文选择器。该入口选择器随后已更新，并在 Windows 本地构建预览下通过 3 个视口；修正后的完整 Linux CI 仍需推送并重新验证。

安全修复候选将服务端 `@fastify/static`、`drizzle-orm`、`nodemailer` 和 `zod` 更新至审计建议版本；本地高危级别审计通过，但仍报告 2 项中危 React Router 问题。此变更含主要版本升级，必须以对应提交的隔离数据库、Web E2E 和实际 GitHub Actions 结果验证兼容性，不能以旧提交的通过结果替代。

GitHub Actions run `40721397365`（提交 `d2548cb`）随后通过全部四个作业：119 项服务端测试重复两次、10 项 Desktop 浏览器测试及 33 项 Web 浏览器测试通过，生产依赖高危阈值审计通过。完整依赖审计另发现开发工具中的 2 项严重和 2 项高危告警；工具链安全升级候选将 Vite、Vitest、Sharp 等更新，本地完整依赖审计还剩 6 项中危（Drizzle Kit 依赖链和 React Router）。该工具链升级仍须在新提交上通过完整 CI；旧 CI 结果不能代替它。

测试数据库的重建操作现在要求显式配置受限的本机测试库及确认变量，详见 [工程工作流](docs/engineering/CODEX_WORKFLOW.md)。仓库历史编译参考的公开再分发权利和第三方许可完整性仍需人工核实。下文是原 Stage 1 审计记录，其历史测试状态不是 Phase 2 的实时结果。

**审计日期：2026-10-26**  
**资料来源：** 用户上传 `meetfolio_2e0bbdd_continued_modified_source(3).zip`，此前开发对话与发布记录；这次没有收到 v0.6.0 的安装包二进制，也没有收到其完整源码。  
**结论：可以增量重建，但“可重建”不等于“已经恢复到 0.6.0 逐字节同版”。**

## 1. 这次 ZIP 到底是什么？

- ZIP 解压目录：`meetfolio-continued/`；共 **270 个 ZIP 条目**，未压缩约 **5.55 MB**，原始 ZIP **3.5 MB**。
- `README.md` 第一段仍自称 **Desktop v0.1.0 integration candidate / Draft PR #6**。`package.json` 及 Electron 桌面子项目版本为 `0.1.0`。
- 目录：`desktop`（Electron + X-ASR 本地运行时）、`web`（React/Vite 及桌面工作台）、`server`（保留的旧 Fastify/PostgreSQL/Qwen Web 原型）、`docs`、`.github/workflows`。
- **存在完整代码，不存在 `.git` 历史**：不能从这份 ZIP 单独恢复旧分支、提交 SHA、Releases 和 PR 审核信息。
- 当前 ZIP 的离线 X-ASR、模型下载导入/修复、麦克风权限和流式转录逻辑是真实源码而非界面占位；但其是否能在今日 Windows/macOS 正常运行，仍需真实系统构建验证。
- 原始包没有 WAV 文件录制/逐句回放、独立 Mac installer 工作流、新版英语 UI、原生 PDF/DOCX 资料导入及桌面 PDF 导出等完整新版实现。

## 2. 版本历程（按开发对话记录重建）

| 版本 / 阶段 | 主要变化 | 证据及限制 |
| --- | --- | --- |
| **v0.1 / PR #4–#6**（10 月 24 日附近） | 三阶段工作流（Preparation → Live → Review）、本地 IndexedDB、人工修改转录、时间戳/来源、TXT/Markdown/DOCX 与 JSON 备份；Electron/X-ASR 本地运行时开始接入，Windows 安装/测试脚本 | **本次上传源码直接证实**；README 明写 v0.1 候选，不能冒称 v0.6 |
| **v0.2** | Quiet Workspace 界面改进、纸质笔记本式布局、参考资料与会中笔记体验；实验性可选本地 Ollama 滚动要点方案 | 依据此前开发记录；具体提交没有在这份 ZIP 中保留 |
| **v0.3** | Windows、macOS Apple Silicon 与 Intel 的跨平台 Preview 安装发布，X-ASR 本地模型交付验证、音频和参考资料能力推进 | 此前已发布 `v0.3.0-preview.3`，跨平台 CI 有成功记录；未等同于真实用户长时稳定性验证 |
| **v0.4** | 实时转录和录音/回放链路加强；Windows 真实麦克风约 20 分钟试用正常；Mac Preview 推进 | 真实短时实测来自用户反馈；滚动 AI 效果和长时间稳定性**未全面证实** |
| **v0.5 Desktop Lite**（10 月 25 日） | **明确转向无生成式 AI 的稳定版**：移除桌面发行版 Ollama/Qwen 配置和 AI 摘要，保留 X-ASR 离线转录、人工记录与资料工作流；交付 Win/macOS | 曾讨论 Windows 桌面快捷方式、安装后运行、Mac 包交付等；不等于旧代码完全移除历史 Web AI 服务 |
| **v0.5.1** | 重点打磨“研究备忘录与参考资料”，区分背景资料与受访者原话，提供文本提取、证据复核和可用性修复；中文界面保留为 Preview | 中文版可以作为独立发布线；继续强调无 AI 总结 |
| **v0.6.0 English Edition**（10 月 25 日） | **桌面 UI 英文化**，ASR 继续支持中英语音；保留离线 X-ASR、录音、笔记、文本编辑、WAV/片段回放、材料导入、人工来源复核与 TXT/MD/DOCX/PDF 导出；Windows x64 + macOS Intel/Apple Silicon 发布 | 根据此前正式发布及 README/测试记录整理；没有实际 v0.6.0 源码与二进制，不能校验逐个文件、哈希或完整兼容性 |
| **v0.6.0 之后：Web Notebook PR #15** | 独立浏览器本地录音（仅音频、不是 ASR）、IndexedDB、研究工作台、腾讯云 Docker/Nginx 部署代码 | **独立于 v0.6.0 正式桌面版**；此前 Draft PR 未并入正式桌面 Release。受 GitHub 封禁影响，本次 ZIP 不包含这些文件 |

**特别提醒：** v0.1–v0.4 期间曾探索 Ollama 和 Qwen。到了 v0.5–v0.6.0，默认桌面发行版明确不提供 AI 摘要。**不要为了重建而把旧 AI 功能重新加进正式版。**

## 3. 按模块逐项对比

图例：**原有**＝原始 ZIP 含代码；**本轮补回**＝Stage 1 恢复包已完成源码改造；**待开发/验收**＝尚不能认为等价于 v0.6.0。

| 模块 | 原始 ZIP | 本轮补回 | 距离 v0.6.0 还缺什么 |
| --- | --- | --- | --- |
| 技术栈 | Electron / React / TS / Vite / X-ASR / IndexedDB，旧 Server 仍在 | **保留原栈、原目录** | 无需换框架；但依赖及安全性还需验收 |
| 访谈三阶段 | 原有 | 沿用、英文界面 | 需实际浏览器和桌面回归 |
| 本地实时转录 | 原有 Electron X-ASR 桥接 | 保留并英文反馈 | 语音设备选项、异常恢复、真实长时 UAT |
| WAV 音频及逐句回放 | 缺失完整支持 | 未擅自伪造 | 原生音频存储、分段索引、停止持久化、回放/清理、安全权限 |
| 参考资料 | 仅文本框和单次 TXT/MD 导入 | **多文件 TXT/MD、本地字段与限制、备份校验、删除/导出来源区分** | PDF/DOCX 本机提取（含格式校验、长度限制），无 OCR |
| 笔记分类/草稿 | 原有 | 英文分类及提示 | 完整 UI 无障碍/回归 |
| 原文更正/证据 | 原有 | 保留、英文来源审查 | 音频播放/片段证据联动 |
| 桌面 Lite 无 AI | 原界面仍有“可选第三方 AI”入口 | **删除桌面上的 AI 宣传与配置误导** | 需要对更多历史代码/安装包装配做安全核对 |
| 数据持久化 | IndexedDB / JSON | 兼容 v0.1 schema 的可选参考文件字段 | 不能假定直接导入 v0.6.0 JSON（更丰富结构需迁移） |
| 访谈搜索 | 原始侧栏无搜索 | **新增加按标题/参与者/转录/笔记/资料名搜索** | 性能和 100 访谈上限验收 |
| 导出 | TXT / MD / DOCX / JSON | 英文文档和背景资料来源字段 | PDF 导出、真实 WAV 备份/单独下载 |
| macOS | 框架 Electron，但无完整打包配置 | 未补 | ARM64/x64 构建、签名/公证策略、权限和原生 ASR 测试 |
| Windows 安装 | 原有 NSIS/图标/测试 | 代码保留 | 真实 Windows 构建、installer/卸载后数据行为测试 |
| 独立网页版 | 旧 Fastify/Postgres Web 原型，不是后来的静态版 | 不混入 Stage 1 | `feat/browser-notebook-mvp` 要从 Codex/Git/单独文件另行恢复 |

## 4. Stage 1 已经具体修改了什么

从上传源码**增量**修改、原项目结构未重写：

- `web/src/desktop/{DesktopApp,LiveInterview,Preparation,ModelCard,ReviewExport,Transcript}.tsx`：英文化桌面访谈主要流程，保留本地转录/人工笔记结构；重写 Review 页以“人工证据复核”取代模糊 AI 功能宣称。
- `web/src/desktop/englishNotes.ts`（新增）：英文研究笔记分类，原有中文服务器 `web/src/lib/zh.ts` 仍保留。
- `web/src/desktop/model.ts`：兼容旧 schema 的 `referenceFiles?`，严格长度/字段校验，旧版备份不因缺字段失效。
- `web/src/desktop/Preparation.tsx`：TXT/Markdown 多文件导入、数量/尺寸限制、删除、仅本机保留文本，标注与访谈原话区别。
- `web/src/desktop/exports.ts`：TXT/Markdown/DOCX 研究记录包含独立参考资料内容，不将背景资料混为受访者发言。
- `web/src/desktop/DesktopApp.tsx`：按标题、参与者、转录、笔记和资料名的本地访谈搜索。
- `web/src/desktop/{persistence,useLocalRuntime,model}.ts`、`fixtures.ts`、`web/desktop/index.html`：界面错误提示、恢复提示和虚构示例英文化；未改变已有 X-ASR 逻辑。
- 原始服务器代码、Electron 原生 ASR 实现与 npm lockfile 保留原状。

> **Stage 1 不是 v0.6.0 的正式源码，也不能从这里直接生成可对外承诺等价的 EXE/DMG。** 它只是从真实旧项目建立的可继续开发、可追踪的增量恢复起点。

## 5. 验收证据和限制

- **已完成**：270 条目源文件清单、ZIP CRC/路径安全检查；增量后的 TS/TSX 语法解析，无语法诊断；使用 TypeScript 转译实际执行 notebook/model/export 数据测试：参考资料往返、旧备份兼容、非法类型和超限拒绝、导出来源标签、录音中断状态。
- **无法完成**：`npm ci` 无法在当前运行环境取得全部依赖（离线缺 npm 包；在线 npm 也未成功），因此无法宣称运行了完整 TypeScript 类型检查、Vitest/Playwright、真实 Electron/Windows/macOS 打包或 X-ASR 物理录音测试。
- **未收到 v0.6.0 安装包**：无法从其 `app.asar` 和资源目录对比差异；安装包也通常不能完美还原 TypeScript 原始源码和 Git 历史。
- **无 `.git`**：打包文件保留的是代码树，不是可 `git log` 的完整 Git 仓库。若 Codex 仍有原工作区，请优先备份 Git bundle，再把该恢复增量迁入其可验证仓库。

## 6. 下一阶段的工程顺序

1. **数据兼容和原生麦克风**：保留原 v0.1 数据，扩展为 v0.6 的 WAV 文件与 transcript 音频引用；确保录音停止、硬盘写入失败、突然关闭时显式提示，不丢失已确认文字。
2. **资料导入**：在 Electron 安全 IPC 中实现本地 PDF/DOCX 解析、逐文件大小/内容限制，并提供扫描 PDF 的不支持说明。
3. **导出与溯源**：原生 PDF，按片段回放及时间戳证据，JSON 明确不包含 WAV；可分别下载音频。
4. **跨平台构建**：Windows NSIS + macOS Intel / Apple Silicon；主进程鉴权、权限/沙盒/第三方许可与资源体积核对。
5. **真实验收**：离线安装并加载模型、录音约 20–30 分钟、暂停/恢复、断麦克风、录音文件损坏/磁盘满、中文/英文样本、重装和卸载后数据保留。
6. **比较 v0.6 安装包**：如果拿到当时发布的 ZIP，在隔离环境检查 release 文件清单与编译后的 UI/功能行为，做差异验证；仍不能替代原始 Git 源码。
7. **单独重建 Web PR #15**：不要把旧 Web/Postgres 原型误当成之后的静态 Browser Notebook；它属于另一条产品分支。

## 7. 结论

这份旧 ZIP **足以避免从零重写**。已有的本地 X-ASR 和 Electron 链路是最有价值的基础；真正费时的是旧版之后反复修复的音频链路、跨平台安装和数据恢复边界。**可以逐模块复现 v0.6.0 的功能，但不能保证仅凭对话与 EXE 就恢复完全相同的提交历史或完全相同的工程质量。**
