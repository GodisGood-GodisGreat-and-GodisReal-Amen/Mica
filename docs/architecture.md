# How Mica works

A map of the code for anyone who wants to change it.

```
 src/head.html     metadata, favicon, theme set before the first paint
 src/style.css     tokens, layout, components, motion
 src/body.html     static markup (lists, grids and settings rows are built by the app)
 src/examples.js   the seven example programs
 src/app.js        the machine, the assembler, the run loop, the interface
        │
        │  tools/build.mjs: esbuild minifies the CSS and JavaScript, a small
        │  pass squeezes the HTML, the kernel example is stored deflated,
        │  and package.json's version goes into the footer
        ▼
 mica.html         the whole app in one file, about 170 KB
```

Two rules shape everything:

1. **One file, no network.** Mica has to work from a double-click, offline, for years. There are no web fonts (it uses the system's), no libraries and no CDN; icons, examples and the favicon are inline.
2. **The run loop never waits for the screen, and the screen never slows the run loop.** The CPU runs in bursts; the interface draws what changed at most once per frame, and drawing never reads layout.

## app.js, section by section

The app is one script, wrapped in a function so nothing leaks into the page, and divided into numbered sections:

| § | Section | What is there |
| --- | --- | --- |
| 0 | utilities | `h()` to build elements, `debounce`, `store` (local storage with the `mica:` prefix) |
| 1 | settings | `DEFAULTS` and `S`, the live settings object, loaded and saved as JSON |
| 2 | machine | `cpu`, the assembler (`assemble`, `tokenize`, `lintText`), and operand access (`read`, `write`, `writeReg`, `writeMem`, `setFlags`, `jump`) |
| 3 | instruction set | `OP_TABLE` and `CATEGORIES`, `compileOp`, `patchOp`, `resetOp` |
| 4 | RAM beep | Web Audio: the waveforms and the custom sample |
| 5 | TTY | the terminal buffer |
| 6 | runner | `runButton`, `startTimer`, `burst`, `execute`, stepping, pausing, input for `IN`, the clocks |
| 7 | rendering | `renderAll`: registers, flags, the memory canvas, the gutter, the next-instruction readout, the CPU tab |
| 8 | editors | `makeEditor`: highlighting, the virtualised gutter, breakpoints, the syntax check, the examples |
| 9 | host commands and hybrid | `HOST`, the System and Hybrid runners |
| 10 | script library | save, load, delete, export and import |
| 11 | modals, drawer, toast, tips | |
| 12 | settings UI | `ICONS`, `SETTINGS`, `makeControl`, `setSetting`, `setTheme`, backdrop and beep files |
| 13 | windows | floating panels, dividers, the manual fold, the TTY height |
| 14 | keyboard | the global shortcuts |
| 15 | boot | builds the interface and restores the saved state |

## Assembling

`assemble(text)` reads the program line by line: it strips comments, records each label (upper-cased) as the number of the next instruction, and tokenises the rest. Every instruction becomes `{ tokens, line, op, a, b }`: `op` points straight at the instruction's definition, `a` and `b` are the operand tokens, and `line` is the source line, for the gutter and for breakpoints. Operands stay text; `read()` resolves them when the instruction runs, with small caches for literals and bracketed operands, so reading a register costs one property lookup.

## Instructions are source text

Each row of `OP_TABLE` holds an instruction's name, operand count, syntax, summary, manual note and the source of its function. `compileOp()` compiles that source with `new Function`, passing the helpers in as parameters: `read`, `write`, `writeReg`, `writeMem`, `setFlags`, `jump`, `print`, `printChar`, `requestInput`, `halt`, `cpu`, `MEM_SIZE` and `S`. That gives three things:

- The CPU tab shows the exact code that runs, even in the minified build.
- **Apply** compiles new source and replaces the definition's `fn`. Every assembled instruction points at that same definition object, so the next one executed uses the new code, mid-run included.
- The helpers reach the compiled code by parameter, so the minifier is free to rename everything else. It also means `cpu` and `S` must never be replaced, only changed in place: an instruction compiled at start-up keeps the objects it was given.

## The run loop

`startTimer()` picks one of three schedules from the clock:

| Clock | Schedule |
| --- | --- |
| 0, instant | runs synchronously for up to 200 ms, then in bursts of 8 ms from a zero-delay timer, drawing once per animation frame |
| 1 to 15 ms | a 16 ms timer runs `16 ÷ clock` instructions per tick (one frame's worth), then draws |
| 16 ms and slower | one instruction and one draw per tick |

`burst(max, budget)` is the hot path: a `while` loop that calls `ins.op.fn(ins.a, ins.b)` and moves the PC on unless the instruction returned `true`. It checks the clock every 64 instructions and hands anything unusual (a breakpoint, an unknown instruction, a PC outside the program) to the full `execute()`, which also takes care of crashes and halts.

`IN` stops the timer and opens the TTY's input row; the value typed is written, and the timer restarts if the program was running.

## Drawing

`renderAll()` updates the registers, flags, memory, gutter and the next-instruction readout. Each part keeps what it drew last and touches the page only for what changed.

- **Memory** is a single `<canvas>`. A cell is redrawn only when its value or its state changes (non-zero, stack, SP, last write, hover, focus). Hover, clicks and keyboard focus are worked out from the cell geometry, and an off-screen live region announces the focused cell to screen readers.
- **The editors** are a transparent `<textarea>` over a highlight layer. The line numbers and the highlighted lines are both virtualised: about 40 recycled rows, however long the program, and a line is highlighted again only when its text changes. Scroll offsets come from scroll events, so drawing never reads them back.
- **Nothing that changes while a program runs is animated.** Memory cells, line numbers, flags and highlighted cards change instantly. The register pulse alternates between two identical keyframe animations, so restarting it never forces a reflow.
- **Containment.** In the desktop grid every panel and scroller has `contain: strict`, so a change lays out and paints only its own box.
- **The TTY** keeps its newest line in view with `flex-direction: column-reverse`, instead of scrolling from script.
- **The theme switch** turns transitions off for one frame and crossfades two snapshots of the page with a View Transition.
- **A divider drag** reads the layout once when it starts and writes one custom property per move; the elements that are expensive to lay out keep their width until the drag ends.
- **Glass blur** is only applied where it shows: over a backdrop photo, or behind a floating panel.

## Storage

`store` wraps `localStorage` with the `mica:` prefix and ignores the errors a private window or full storage throws. The settings are one JSON object, saved 250 ms after the last change. The editors save as you type, after a short pause, and again when the page is hidden or closed. The theme and motion preference have keys of their own, which a tiny script in the head reads before the first paint.

## The build

`tools/build.mjs` reads the five sources and writes `mica.html`:

1. The kernel example moves out of `EXAMPLES` into `PACKED_EXAMPLES`: raw deflate, base64, and an FNV-1a hash of its text. The hash lets the Example menu recognise the kernel in the editor without unpacking it; the browser unpacks it with `DecompressionStream` the first time it is chosen.
2. esbuild minifies the CSS, the app and the inline head script.
3. A small HTML pass removes comments and the whitespace between tags. It never touches the inside of `<textarea>`, `<pre>`, `<script>` or `<style>`, nor a quoted attribute value.
4. `__VERSION__` in the markup becomes `package.json`'s version.

`--readable` skips steps 1 to 3, for debugging. `tools/check.mjs` builds in memory and compares the result with the committed `mica.html`, after unpacking the kernel on both sides, so a different zlib cannot fail the check.

## Tests

`test/suite.js` runs inside the page and drives Mica as a person would, with clicks, typing and keys, then reads the results back from the page. It never touches the app's internals. `test/run.mjs` opens `mica.html` from disk, with empty storage, either in headless Chrome, which it drives over the DevTools protocol with Node's built-in WebSocket, or in WebKit through `tools/webshot.swift`, a small offscreen `WKWebView` runner for macOS. GitHub Actions runs `npm run check` and the suite in Chrome on Linux and in WebKit on macOS, on every push and pull request.

## Measuring performance

`tools/perf/bench.js` holds benchmark scenarios: interpreter speed, work per tick at a timed clock, the theme switch, the settings drawer, typing in the kernel, and a divider drag. `tools/perf/harness.html` puts two builds side by side in one page, so both run with the same priority, and loads the scenarios into either. Serve the repository over HTTP and open `tools/perf/harness.html?a=baseline.html&b=../../mica.html`; then, in the console, `await inject('b')` and `await B('b').instant()`.

For absolute numbers, `tools/webshot.swift` runs pages in WebKit offscreen with the timers of hidden pages unthrottled. Compare builds by interleaving runs (A, B, A, B), never from a single pair.
