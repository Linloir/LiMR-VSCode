# VS Code 1.0.2 performance verification

Tested on 2026-10-17 with npm LiMR 1.3.0, VS Code 1.142.0 / Electron 43.7.7 / Chromium 150, WSLg, Intel i7-13700 and UHD 770. GPU compositing was observed enabled. Each trial used a frozen production bundle and a fresh profile. User settings and GPU launch preferences were not changed.

## Host overhead

A 20,990,677-byte Chinese prose document was loaded three times per variant. Both variants used the same published core and renderer. The baseline restored JSON source messages and the previous supplementary source-highlighting worker; the candidate used binary messages and bounded supplementary parsing.

| Median | Previous host path | Updated host path |
| --- | ---: | ---: |
| Open request → source arrival | 932.8 ms | 405.0 ms |
| Source arrival → complete reader | 1041.3 ms | 1082.3 ms |
| Open request → complete reader | 1966.4 ms | 1487.3 ms |
| Worker request → complete snapshot | 951.3 ms | 956.4 ms |

The measured end-to-end reduction is 24.4%. UTF-8 decoding adds some webview work, while avoiding JSON copies reduces host delivery overhead. The first interval includes webview startup, so it is not a pure IPC measurement. This does not establish a universal VS Code-versus-browser performance ratio.

The median sampled process-tree RSS peak was 1385 → 1353 MiB, with enough variation that no stable percentage memory improvement is claimed. Sampling runs once per second and counts shared pages per process; it is not unique physical memory or LiMR heap usage. Source decoration parsing is skipped above 4 Mi UTF-16 characters, its queued jobs retain document references instead of extra source strings, and hidden/closed active jobs terminate.

## Limit and rendering checks

An exact 78,643,200-byte (75 MiB) prose document reached complete-reader state in 4.99 seconds from the open request. Its preview appeared 223.2 ms after source arrival. Reading during background parsing preserved the same source character and viewport position after completion; the observed viewport mounted 14 blocks. This is one boundary trial, not a guarantee for every Markdown structure.

A bilingual technical paper was tested three times, including translations, resizing, copy/search source checks and scrolling. Median frame P95 was 17.5 ms for steady reading, 49.3 ms for fast scrolling, and 64.5 ms for repeated seeks. Fast movement still incurs layout work; it is not guaranteed to stay at 60 fps. No missing visible blocks, adjacent-block gaps or overlaps were observed. These are programmatic frame timings, not input-to-photon latency.

The UI acceptance suite separately verifies exactly 75 MiB, rejection at one additional UTF-8 byte, and a genuinely stalled native worker. With the production deadline unchanged, the host reclaimed the guest/worker after about 60.3 seconds and retry succeeded.

## Reproduction and supported choices

See [the harness](../benchmarks/reading/README.md), `--loading` / `--limits` in [development](development.md), and the generated `artifacts/1.0.2-performance/summary.json` for raw report locations and candidate hashes. The baseline source copy records its two deliberate reversions in `comparison.json`.

The extension uses [VS Code's ArrayBuffer message support](https://code.visualstudio.com/api/references/vscode-api#Webview), LiMR worker parsing and windowed rendering, stable parser instances across palette/locale changes, and deferred updates for hidden readers. Retaining hidden readers preserves drafts and avoids expensive reparsing; closing tabs releases those documents. The extension does not override client GPU settings or add blanket compositing layers that could increase memory and disturb source geometry.
