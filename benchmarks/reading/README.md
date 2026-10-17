# VS Code 阅读性能基准 / Reading benchmark

此命令运行真实 Linux VS Code Electron，加载冻结的生产扩展、真实 parser worker、核心 `AsyncReader` 和窗口阅读。每个案例使用新的临时 profile、扩展目录及文档副本；不会安装到用户 VS Code、修改用户设置或改写样例文件。构建发生在报告目录中的独立副本，不覆盖仓库 `dist`。

This runs the actual Linux Electron extension with a frozen production build. Each case gets a disposable profile and copied workspace. It does not install into your VS Code, change your preferences, or modify the samples. The candidate is built in the report directory, without replacing the repository's `dist`.

## 运行 / Run

从仓库根目录运行。需要已安装的 npm 依赖、可用桌面/X11，以及 `.vscode-test` 中缓存的 Linux VS Code。无显示器的机器可用 `xvfb-run -a` 包装命令，但必须记录与桌面环境的差异。

Run from the repository root with npm dependencies installed, a working display/X11, and cached Linux VS Code under `.vscode-test`. On a headless machine, `xvfb-run -a` can wrap the command; keep that environment distinct from desktop measurements.

测试尚未发布的本地 core 候选时，先在 core 仓库打包，再在本仓库临时安装该 tarball；不修改 manifest 或 lockfile 版本。`pnpm pack` 会运行 core 的 `prepack` 构建，需安排在性能测量之前。

For an unpublished local core candidate, pack it in the core repository and temporarily install that tarball here. Keep manifest and lockfile versions unchanged. Core's `prepack` builds the package; finish it before any timed runs.

```sh
# In the core repository:
pnpm pack --pack-destination /tmp/limr-local-pack
# Back in limr-vscode; use the exact tarball path printed by pnpm:
npm install --no-save --package-lock=false --ignore-scripts /path/to/linloir-limr-1.2.3.tgz
```

请勿使用 `npm link`：宿主短 ID 构建适配器会严格检查受支持版本、四个创建表达式及 `@linloir/limr/dist` 路径；指向其他目录的符号链接可能触发路径保护失败。不要绕过这些检查；真实 tarball 安装也是消费包验证的前提。仅比较版本号不足以区分同版本候选，报告会记录实际 core/资源指纹。

Do not use `npm link`: the short-ID build adapter checks the supported version, four reviewed creation expressions, and the `@linloir/limr/dist` path. Symlinks to other directories can fail its path guard. Do not bypass these checks. The report records core/asset fingerprints because version numbers alone cannot distinguish local candidates.

先运行单个 smoke case：

```sh
BENCH_DOCUMENTS=2305.10435v2.zh-CN.limr.md BENCH_MODES=standard BENCH_SIDEBARS=adaptive BENCH_TRIALS=1 node benchmarks/reading/run.mjs
```

完整矩阵是两篇文章 × standard/justify/knuth-plass × adaptive/aligned × 三轮，共 36 个独立 Electron 会话：

```sh
node benchmarks/reading/run.mjs
```

建议先通过 smoke，然后按模式串行分组；不要与其他浏览器、构建或性能测试同时运行：

```sh
BENCH_MODES=standard node benchmarks/reading/run.mjs
BENCH_MODES=justify node benchmarks/reading/run.mjs
BENCH_MODES=knuth-plass node benchmarks/reading/run.mjs
```

通常每个案例约 25–50 秒，完整矩阵约 15–30 分钟；初始化、低帧率、文件大小和几何稳定等待会延长时间。这是估计，不是本脚本已测得的结果。脚本未设置帧率通过阈值；`valid` 表示测量路径与几何检查有效，并不表示已经满足流畅度目标。

Estimate: 25–50 seconds per case and 15–30 minutes for the full matrix. This is an estimate, not a measured result. A `valid` result means the intended path and geometry checks passed, not that a responsiveness target was met. Inspect actual frame distributions.

独立检查大型文件 loading：把已有的 50/75 MiB 文件放在指定目录，显式提供文件名。该模式跳过滚动、翻译和 resize，只测宿主开读、文档传递、worker 与首屏稳定。

```sh
BENCH_SOURCE_DIR=/tmp/limr-novels BENCH_DOCUMENTS=novel-50MiB.md,novel-75MiB.md BENCH_PHASES=loading BENCH_MODES=standard BENCH_SIDEBARS=adaptive BENCH_TRIALS=3 BENCH_ASSETS= node benchmarks/reading/run.mjs
```

Loading-only runs skip scrolling, toggles and resize. Inputs must still have a visible opening heading and enough blocks to activate the real worker/windowing path. For safe independent prose, repeat with `BENCH_LOADING=progressive` to observe the prefix; complex syntax may correctly produce no prefix. File byte size and JavaScript UTF-16 character count are both recorded.

纯小说的加载后阅读和渐进交接使用独立 workload。先在计时之外生成确定的 50/75 MiB 样例（完整段落会让实际字节数稍大于目标，manifest 记录实际值），再串行执行：

```sh
node benchmarks/reading/novel-fixtures.mjs /tmp/limr-vscode-novels
BENCH_SOURCE_DIR=/tmp/limr-vscode-novels BENCH_DOCUMENTS=novel-50MiB.md BENCH_WORKLOAD=novel BENCH_PHASES=all BENCH_MODES=standard,knuth-plass BENCH_SIDEBARS=adaptive BENCH_TRIALS=1 BENCH_ASSETS= BENCH_OUTPUT=/tmp/limr-vscode-novels-blocking node benchmarks/reading/run.mjs
BENCH_SOURCE_DIR=/tmp/limr-vscode-novels BENCH_DOCUMENTS=novel-75MiB.md BENCH_WORKLOAD=novel BENCH_LOADING=progressive BENCH_HANDOFF=read,reveal,gesture BENCH_PHASES=all BENCH_MODES=standard BENCH_SIDEBARS=adaptive BENCH_TRIALS=1 BENCH_ASSETS= BENCH_OUTPUT=/tmp/limr-vscode-novels-progressive node benchmarks/reading/run.mjs
```

这五个独立会话是功能 smoke，尚不是三轮性能结论。小说模式明确跳过翻译按钮查找；分别停驻首段、中段、末段测平稳/快速滚动，另测远距跳转、终章标记与中部窗格 resize，检查真实字符的源码位置、DOM 上界和相邻 slot 几何。生成器与最终 hash 计算都不在计时窗口。只需重查交接时，使用 `BENCH_PHASES=handoff` 跳过后续阅读 workload。

The five sessions above are functional smoke cases, not three-trial performance conclusions. Novel workloads skip translation setup explicitly, measure steady/fast reading at the beginning/middle/tail, then separate distant seeks, the final sentinel and pane resizing. They check source-tagged glyphs, bounded DOM and adjacent slot geometry. Fixture generation and final hashing are outside timed phases. `BENCH_PHASES=handoff` runs only handoff and source-sync checks.

生成输入是带唯一段落编号的中文纯正文，没有表格、链接、翻译、注释，也没有宿主语法高亮预筛中的 `< : $ = ^ [!`。源码语法高亮仍保持默认启用，但这些输入会走它的空 token 快捷路径；结果不能外推为含冒号英语正文或 50 MiB 富语法 Markdown 的相同性能。字符定位专用于这类源字符与实际 text span 一一对应的输入；KP 的原空格仍计入，生成的 ignore 节点不计入。映射不匹配会单独报“不支持定位”，不解释为阅读位置故障。

Generated inputs are Chinese plain prose with unique paragraph numbers, without tables, links, translations or annotations, and without the host syntax-highlighting prefilter characters. Source syntax highlighting remains enabled; these fixtures take its empty-token fast path. Do not extrapolate the results to colon-rich English prose or 50 MiB of complex Markdown. Glyph positioning is limited to direct source/text mappings; KP's original spaces count, generated ignored nodes do not. A mismatch is reported as an unsupported test mapping, not a product anchor failure.

`read` 在真实 prefix 可见时发送受控 wheel 事件，滚到非顶部并按源码字符及其屏幕偏移检查 full-ready 保位；`reveal` 在 prefix 中通过真实 VS Code 编辑器请求 80% 位置，检查完成后应用；`gesture` 先排队该请求，再发送 reader wheel，检查最后一次 reader 手势优先。后两项不伪造 Webview reveal 消息。三个 case 都在完成后用真实鼠标滚轮验证 reader→source，并从真实编辑器反向定位，拒绝反馈循环。prefix wheel 是合成输入，用于功能与所有权验证，不代表硬件输入延迟；交接主动操作也会影响 loading 时间，不与无交互 loading-only 数值混比。

`read` exercises a controlled wheel event in a visible, incomplete prefix and compares the same actual source glyph before/after engine replacement. `reveal` queues an actual native-editor seek to 80%; `gesture` supersedes that pending request with reader input. All verify both directions after completion using the real editor and a real mouse wheel. Synthetic prefix input tests behavior and ownership, not hardware latency. Interactive handoff loading times must remain distinct from passive loading-only measurements. No parser delay is injected. If the action arrives only after full ready, the case fails as **not exercised**; it is not silently accepted.

另外可用 `BENCH_HANDOFF=initial BENCH_PHASES=handoff` 单独探测首次构造 scrollRoot 前的 reveal。该路径必须记录 `rootPresent=false`；若机器上事件到得较晚，报告“未覆盖”，不能把普通 prefix reveal 当作该初始化竞态的证据。所有 handoff case 自动启用临时 profile 的 `syncScroll`，不会改动用户设置。

表格宿主功能验收另有独立入口，消费当前已构建的 `dist`（先完成最终候选的 `npm run build`）。它检查真实 500/760/1100 正文宽度、稀疏/引用/19 列表格、glyph/角标几何、原生旁栏/悬浮预览与列表翻译尾标；报告包含窗口文档、worker 事件、源码不变及截图。它不计入性能矩阵：

```sh
VSCODE_EXECUTABLE_PATH="$PWD/.vscode-test/vscode-linux-x64-1.142.0/code" LIMR_TEST_ARTIFACTS=/tmp/limr-vscode-tables node scripts/test-vscode.mjs --table-layout
# For a frozen candidate, add: LIMR_TEST_EXTENSION_PATH=/path/to/frozen-extension
```

After installing a new local core candidate, `LIMR_TEST_TABLE_SECTIONS=images` runs only the actual host's table-overflow image combination: a resolved local SVG is cloned into the native annotation overlay/sidebar, opened with the shared preview, zoomed and closed with focus restored. It checks that the clone/modal reuse the resolved URI, do not trigger another host image lookup, and leave Markdown unchanged. The default sections are `layout,images,translation`.

安装新 core 本地候选后，可加 `LIMR_TEST_TABLE_SECTIONS=images` 仅验证实际宿主的表格省略图片路径：本地 SVG 解析完成后，原生悬浮/侧栏中的克隆图复用基础预览，缩放和关闭后恢复焦点，复用已解析 URI，不额外查询宿主资源，不修改 Markdown。默认运行 `layout,images,translation` 三节。

The separate table acceptance entry consumes the currently built `dist`; finish the final candidate build first. It covers actual content widths and host typography/ref/annotation CSS through windowed documents, plus native sidebar/overlay previews and list translation markers. Use your actual cached Linux Electron path. These are functional checks, outside the performance matrix.

插件的大文档合同有独立入口，复用真实附加扩展和临时工作区。800 段、超过 64 KiB 的源文先由两个同名工厂的独立视图渲染器处理，确认原对象名称未被改写、完整 worker 响应及窗口阅读；随后加入自定义语法，直接检查其 transform 在 document 环境执行且语法内容保留；移除后确认恢复 worker。测试不以“未看到 worker”单独证明回退，也不把兼容解析视作任意插件的大文件性能保证。

```sh
VSCODE_EXECUTABLE_PATH="$PWD/.vscode-test/vscode-linux-x64-1.142.0/code" LIMR_TEST_ARTIFACTS=/tmp/limr-vscode-large-plugins node scripts/test-vscode.mjs --large-plugins
# For a frozen candidate, add: LIMR_TEST_EXTENSION_PATH=/path/to/frozen-extension
```

The large-plugin entry uses the existing disposable installed add-on and workspace with an 800-paragraph source above 64 KiB. It checks independent renderers with the same factory name, unchanged original names, a complete real worker response and windowing. A registered custom syntax factory then proves its compatibility transform executes in the document realm and preserves authored syntax; removing it restores worker parsing. Absence of worker activity alone is not accepted as proof of fallback. This is a functional contract check, not a performance guarantee for arbitrary plugins. It consumes the current built `dist`, records asset hashes and changes no user installation or persistent settings.

For either acceptance command, `LIMR_TEST_EXTENSION_PATH=/absolute/path/to/frozen-extension` selects a previously built product instead of the workspace `dist`; tests and fixtures still come from this repository. The runner hashes every product asset, including split chunks and the parser worker, and checks `reading-build.json` when present. `build.json` is retained even if a browser assertion fails. The skill-isolation suite does not accept this override because it deliberately creates its own isolated build.

上述验收可用 `LIMR_TEST_EXTENSION_PATH=/绝对路径/冻结扩展` 指定已构建产品，测试脚本和 fixture 仍使用当前仓库。入口记录所有产物（包括分包和 parser worker）的哈希，并核对已有 `reading-build.json`；浏览器断言失败仍保留 `build.json`。技能隔离套件自行构建临时产物，不支持该覆盖项。

## 配置 / Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `BENCH_SOURCE_DIR` | `../test-reading` relative to this repository | Input Markdown and relative asset directories |
| `BENCH_DOCUMENTS` | `1706.03762v7.limr.md,2305.10435v2.zh-CN.limr.md` | Comma-separated filenames inside the input directory |
| `BENCH_ASSETS` | All `*.assets`, `assets`, `images` directories in the input directory | Comma-separated asset directories; empty disables copying |
| `BENCH_MODES` | `standard,justify,knuth-plass` | Typography cases |
| `BENCH_SIDEBARS` | `adaptive,aligned` | Sidebar cases; always visible, collapse enabled/disabled |
| `BENCH_TRIALS` | `3` | Fresh-profile repetitions; order rotates each round |
| `BENCH_LOADING` | `blocking` | `blocking` or `progressive` |
| `BENCH_PHASES` | `all` | `all`, passive `loading`, or functional `handoff` |
| `BENCH_WORKLOAD` | `paper` | `paper` or plain `novel`; novel skips translation UI and adds three reading stations |
| `BENCH_HANDOFF` | `read` for progressive novels; otherwise `none` | Comma-separated `none,read,reveal,gesture,initial`; active handoffs require progressive novels and enable syncScroll |
| `BENCH_WIDTH`, `BENCH_HEIGHT` | `1920`, `1080` | Workbench viewport; minimum 1000 × 600 |
| `BENCH_SYNC_SCROLL` | `0` | `1` verifies actual source↔preview sync during reading phases; real-input setup and native range evidence are outside timing |
| `BENCH_GPU` | `default` | `default` preserves Electron GPU policy; `disabled` adds `--disable-gpu` for an explicit software-path comparison |
| `BENCH_OUTPUT` | `artifacts/benchmarks` | Parent for a unique report/candidate directory; `/tmp/...` is supported |
| `BENCH_SCREENSHOTS` | `1` | `0` skips initial screenshots; failures still capture a screenshot |
| `BENCH_KEEP_GOING` | `0` | `1` continues after invalid cases; the overall exit status still fails |
| `BENCH_KEEP_PROFILE` | `0` | `1` retains the isolated profile/workspace for diagnosis |
| `VSCODE_EXECUTABLE_PATH` | Auto-detect cache | Explicit Linux Electron `code` executable; not the shell CLI |
| `BENCH_VSCODE_CACHE` | `.vscode-test` | Cache directory containing `vscode-linux-x64-*` / `vscode-linux-arm64-*` |
| `VSCODE_TEST_VERSION` | Newest compatible cached version | Restricts cache selection; also controls an explicitly permitted download |
| `BENCH_DOWNLOAD` | `0` | `1` permits the test-electron downloader when no matching cache exists |
| `BENCH_NO_BUILD` | `0` | `1` reuses `BENCH_READING_BUILD`; source/core/lockfile/harness and asset hashes must match |
| `BENCH_READING_BUILD` | unset | Frozen candidate directory from a previous report, containing `reading-build.json` |

## 指标和有效性 / Metrics and validity

- `readiness` records source-message arrival, Worker construction, real load `postMessage` start/end, first progress, optional prefix, full snapshot/packet completion, the `data-reader-ready` transition, and fonts plus stable visible geometry. Document-ready starts at the matching **source message**, never navigation timing. Worker construction is not worker execution; first progress is the first observed acknowledgment. `hostOpenToSourceWallMs` includes Webview creation and host transport and is **not** a pure IPC cost. `request.postMessageMs` measures the synchronous client-side handoff, not full worker parsing. All local frame deltas use the same `performance.now()` clock, including the first resize frame.
- `host.cjs` uses the same public VS Code commands as the functional acceptance host, but returns only small command acknowledgments. It does not serialize the document into test IPC during open, layout or configuration. A final source hash is computed in the extension host after measured phases. Otherwise an additional 50–75 MiB test-only JSON copy would distort large-file loading and resize results.
- Before timing, the isolated profile closes Explorer, the auxiliary Chat pane and the bottom panel using public workbench commands. This makes the wide reader/sidebar case consistent across VS Code versions with different fresh-profile defaults. Source and reader editor groups remain open. Actual viewport and content widths are recorded; this is a declared layout case, not a reproduction of every user's workbench layout.
- The actual worker must load the requested source length, finish its revision, and load an asset whose SHA-256 matches the frozen parser bundle. A mounted `[data-limr-windowed]` and real slots are required; main-thread or full-DOM fallback is an invalid case. Source, typography, sidebar and loading settings are checked. A final source hash rejects accidental document edits.
- `steady` scrolls at 480 px/s for three seconds; `fast` advances 120 px per frame for 120 frames; `seek` traverses the entire scroll range and returns over 120 frames. They have separate frame distributions. These are programmatic scroll workloads, not measured input-device latency.
- With `BENCH_SYNC_SCROLL=1`, each paper scroll/translation probe first receives a real browser wheel in the reader, records `isTrusted`, restores its original scroll position, and waits for reader/native-editor ranges to settle. All this setup is outside the original probe interval. After each scrolling probe, read-only host IPC must show at least one changed source-editor visible range during that interval, with no editor-to-reader reveal echo. Stationary translation trials record evidence but do not require a range change. `measurements.paperSync` retains the gesture, original/restored positions, before/after native ranges and events; report summaries include per-phase counts.
- For synchronized `novel` / `all` cases without a progressive handoff, the existing bidirectional `checkSourceSync` runs once before the reading stations to acquire real reader input ownership. Each steady/fast station probe then only reads native range evidence outside timing; it adds no wheel, reveal or scroll that could change the station's source character. Existing progressive handoff setup is unchanged. Evidence is retained under `measurements.sourceSync` and `measurements.novelSync`.
- These gates prove that actual synchronization occurred during each checked scrolling phase; they do not claim every frame synchronized. Older reports with only `settings.syncScroll=true` lack this proof and must not be relabeled as verified synchronization. The new harness remains part of the frozen source fingerprint: re-freeze through the existing build process and retain the source/asset guards.

`BENCH_SYNC_SCROLL=1` 现在要求实际输入与源编辑器变化证据：论文每个阶段先在计时外发送真实滚轮、恢复原起点并等待两侧稳定；随后在原计时区间内确认源编辑器可见范围确实变化，且没有反向 reveal 回声。静止翻译只记录、不强求范围变化。没有渐进交接的小说阅读会先复用既有双向同步检查取得阅读器输入所有权，各站点随后只读校验，不增添滚轮或改动源码字符位置。此规则证明被检查阶段内发生过同步，不承诺每帧同步；旧报告只有配置开启而无事件证据时，不能认定同步已实际覆盖。同步关闭及原渐进交接路径保持原行为，步长、速度和计时算法未改。

- Translation tests locate a fully visible, enabled switch inside the actual reader viewport; overscan/parked content is excluded. Each click must change its containing translation's `data-mode`. Three stationary and three simultaneous-scroll trials record the commit time and 850 ms of frames. Finding a visible switch is setup outside the timed region.
- Resize tests change the real editor-group ratio, then the actual reader max width. They capture all frames from before the host action until stable geometry. Stability requires 150 ms without visible paragraph changes and no visible stale KP marker, with a six-second cap. This is measured settling, not an exact compositor paint timestamp.
- Native layout checks now verify `getEditorLayout`, matching source/custom-editor tab identities, the actual two group rectangles and the reader frame. The requested source fraction must match within one CSS pixel of usable group width; two consecutive native frames must agree. A single layout command is followed by a bounded six-second read-only check, with no corrective layout retries. Paper reading/translation checkpoints are outside their original timing intervals. Resize timing still begins before the command and now includes target-layout observation before reader stability; acknowledgment, target observation and stable completion are retained separately. Do not pool these resize results with older acknowledgment-only runs.
- Initial visible heading and adjacent mounted slot gap/overlap are recorded. Differences above 1 px, empty sampled viewports, negative/nonfinite intervals and settling timeouts invalidate the case. Three-point coverage misses are diagnostic only because legitimate images and margins can contain whitespace.
- Runtime/worker errors, Webview HTTP failures, failed requests, console messages, loaded asset hashes and Electron logs are retained. Browser/workbench console noise is reported separately from reader runtime failures. Resource-body hashing runs **after** the timed phases. Geometry sampling adds observer overhead; compare runs made with this same harness and environment. Focus emulation is enabled. By default the runner preserves Electron's GPU policy; `BENCH_GPU=disabled` explicitly disables it. Browser-target `SystemInfo.getInfo` is captured before reader open and after the reading phases, outside timing. `gpuStart`/`gpuEnd` retain the actual renderer, driver, feature status and GPU crash count; an unavailable observation invalidates the measured case. Omitting the flag does not itself prove hardware acceleration. Keep different GPU policies or actual renderers separate when comparing results.

默认遵循 Electron 自身的 GPU 策略，`BENCH_GPU=disabled` 可显式复测软件路径；实际 GPU 状态在开读前和全部阅读阶段结束后读取，不计入测量时间。报告保留驱动、renderer、功能状态及崩溃次数，不能仅凭省略禁用参数就认定硬件加速。旧报告固定禁用 GPU，仍只代表其原环境；环境配置变化不能记作源码优化收益，也不能将不同 GPU 状态混成一组性能结论。此配置只影响临时测试进程，不修改用户 VSCode 设置。

分栏检查同时核对 VSCode 布局模型、源码与阅读器标签身份、实际两个编辑组及阅读器 frame 的尺寸；目标比例允许的误差为可用组宽的一像素，并要求连续两帧一致。布局命令只发一次，后续只读等待最长六秒，不通过重复命令纠正失败。缩放计时仍从命令前开始，现在额外包含目标布局确认，因此不能与旧版仅等待命令回执的缩放结果直接混用。

结果为 `report.md`、完整 `report.json`，以及每个案例的 `result.json`、截图和 `electron.log`。报告包含生产资源 hash（包括 parser worker）、实际加载资源 hash、输入 hash、扩展与 core 版本、源码/core 指纹、VS Code 版本、系统与模式。失败会保留证据并返回非零退出码；Ctrl-C 会终止本案例的隔离 Electron 进程组。

Reports include a concise Markdown table, full JSON, per-case raw evidence/screenshots/logs, input and built/loaded asset hashes, source/core fingerprints and runtime versions. Failed cases remain visible and return a nonzero exit status. Ctrl-C terminates the disposable Electron process group.
