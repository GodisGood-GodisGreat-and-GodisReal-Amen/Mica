# Contributing

Thanks for looking under the hood. Mica is small on purpose: five source files, one built file, no runtime dependencies and one development dependency. Keep it that way where you can.

## Running from source

```bash
git clone https://github.com/GodisGood-GodisGreat-and-GodisReal-Amen/Mica.git
cd Mica
npm install
npm run build
```

Then open `mica.html`. After each change in `src/`, run `npm run build` again and reload the page. `npm run build:readable` builds the same page without minification, which is easier to step through in the browser's debugger; build the minified one again before you commit.

| Command | What it does |
| --- | --- |
| `npm run build` | builds `mica.html` from `src/` |
| `npm run build:readable` | the same, unminified, with the kernel example left as text |
| `npm run check` | syntax of every script, `mica.html` up to date, the version in the changelog, links in the docs |
| `npm test` | the browser tests in headless Chrome, Chromium or Edge (`CHROME=/path` picks one) |
| `npm run test:webkit` | the same tests in WebKit, Safari's engine (macOS, needs `swiftc`) |
| `npm run screenshots` | renders the pictures in `docs/images/` (macOS) |

## Layout

| File | What it is |
| --- | --- |
| `src/head.html` | the document head: metadata, the favicon, and the script that sets the theme before the first paint |
| `src/style.css` | the whole stylesheet: tokens for both themes, the layout grid, components, motion |
| `src/body.html` | the static markup; register cards, the memory grid, the settings rows and the manual are built by the app |
| `src/examples.js` | the seven example programs, as `EXAMPLES` |
| `src/app.js` | everything else, in fifteen numbered sections |
| `mica.html` | the built app, committed so the repository always has a working copy |
| `tools/build.mjs` | the build |
| `tools/check.mjs` | the checks behind `npm run check` |
| `tools/webkit.mjs`, `tools/webshot.swift` | the offscreen WebKit runner used by the WebKit tests, the screenshots and the benchmarks |
| `tools/screenshots.mjs` | the pictures in `docs/images/` |
| `tools/perf/` | benchmark scenarios and a page that runs two builds side by side |
| `test/suite.js` | the functional tests, which run inside the page |
| `test/run.mjs` | opens the page in a browser, runs the suite and reports |

[How it works](docs/architecture.md) explains the code section by section.

## Conventions

- **One file, no network.** The built page must keep working from a double-click, offline. No web fonts, libraries or CDNs; inline anything the page needs.
- **Plain JavaScript and CSS, no frameworks.** esbuild only minifies; nothing is transpiled. Target the browsers named in the [README](README.md#browsers), and treat anything newer as an enhancement the page can do without.
- **`cpu` and `S` are changed in place, never replaced.** The compiled instructions hold references to them.
- **Instructions live in `OP_TABLE` as source text**, and use only the helpers `compileOp` passes in. Their code is what the CPU tab shows, so keep it short and readable.
- **Nothing that changes while a program runs is animated, and drawing never reads layout.** Cache what you need from events (scroll positions, sizes) and touch the page only for what changed. Animate with `transform` and `opacity`, and honour reduced motion.
- **Comments say why, in plain words.** Keep that voice, in the code and in the docs.
- **Bump the version** in `package.json` with every release and add its entry at the top of `CHANGELOG.md`; the footer takes the version from `package.json`.
- Match the existing style: two-space indent, single quotes, semicolons.

## Testing

`npm test` runs `test/suite.js` in a fresh page, in headless Chrome, and prints one line per check. Each check drives the interface like a person would and reads the result from the page, so a check that passes means the visible feature works. When you add a feature, add a check for it in the same style; when you fix a bug, add the check that would have caught it.

On a Mac, `npm run test:webkit` runs the same suite in Safari's engine. GitHub Actions runs `npm run check` and both test runs on every push and pull request.

## Debugging

- `npm run build:readable` gives you the real source in the browser's debugger.
- The System tab's `JS` command evaluates JavaScript with the machine in scope: `JS cpu.registers`, `JS cpu.memory.slice(0, 16)`.
- `tools/perf/bench.js` measures the interpreter, the work per tick, the theme switch, typing and a divider drag. Load it into the page and call the scenarios on `window.__bench`, or use `tools/perf/harness.html` to compare two builds; [How it works](docs/architecture.md#measuring-performance) explains how.

## Pull requests

Keep them focused, describe what changed in the user's terms, and add a line to `CHANGELOG.md`. Run `npm run build`, `npm run check` and `npm test` first, and commit the rebuilt `mica.html` with your change. Screenshots help for anything visual.

Mica is public domain under [The Unlicense](LICENSE). By contributing, you dedicate your contribution to the public domain on the same terms.
