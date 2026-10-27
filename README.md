# Mica

A little virtual machine that runs in your browser. Write assembly for a tiny CPU, run it, step through it one instruction at a time, set breakpoints, and watch the registers, the flags and all 1,024 memory cells change as it goes. Every instruction is a few lines of JavaScript that you can read and rewrite while a program runs, and two more tabs drive the machine from outside: one with plain commands, one that mixes those commands with assembly in a single script.

Mica is one HTML file with nothing to install: download it, double-click it, and it opens in your browser. It makes no network requests and keeps your programs and settings in your browser's own storage.

![Mica running its kernel: the shell's source in the editor, the registers, memory and TTY on the right, the manual below](docs/images/mica.png)

## What it does

- **A small, complete CPU.** Four registers, a program counter, a stack pointer, two flags and 1,024 memory cells. Its 33 instructions cover moving data, arithmetic, bitwise logic, comparisons and jumps, a stack with calls and returns, and input and output through a TTY.
- **An editor that knows the language.** Syntax highlighting, line numbers, and a syntax check as you type that names the problem and its line. Seven examples to start from.
- **Run it at any speed.** Flat out (millions of instructions a second, while the page stays responsive), at a clock you choose (the slider goes from 1 ms to 2 s per instruction), or one step at a time. Click a line number to set a breakpoint, and Resume carries on from there.
- **Watch everything change.** Registers pulse when they change. The memory grid marks the last write, the stack and the stack pointer. The header always shows the next instruction with the values it will use.
- **Change anything, at any time.** Click a register, a flag or a memory cell to edit it.
- **Rewrite the CPU itself.** The CPU tab shows each instruction's code. Edit one and press Apply, and the machine runs your version straight away; Reset puts the original back.
- **Drive it from outside.** The System tab runs host commands that act on the machine from above, such as `SET`, `MEM`, `FILL`, `DUMP`, `RUN`, `CLOCK`, `THEME` and `JS`, among 38 in all. The Hybrid tab mixes assembly and host lines in one script, on one shared machine.
- **A shell to play with.** The kernel example is a 1,900-line program written in Mica assembly. It is a command shell with arithmetic, number bases, variables, sorting and random numbers, plus a tiny stack language of its own.
- **Make it yours.** Light and dark glass themes, your own photo as the backdrop, and panels you can resize, float and rearrange. The RAM beep plays four waveforms or a sound file of your own, and a script library exports and imports your work.

| Paused on a breakpoint, dark theme | An instruction patched live | Settings |
| --- | --- | --- |
| ![](docs/images/dark.png) | ![](docs/images/cpu.png) | ![](docs/images/settings.png) |

## Quick start

Download `mica.html` from the [latest release](https://github.com/GodisGood-GodisGreat-and-GodisReal-Amen/Mica/releases/latest) and open it in Safari, Chrome, Edge or Firefox. That is all: the file is the whole app, about 170 KB. Pick an example, press **Run**, and the [startup guide](docs/getting-started.md) takes it from there.

To work on the code you need [Node.js](https://nodejs.org) 22 or newer:

```bash
git clone https://github.com/GodisGood-GodisGreat-and-GodisReal-Amen/Mica.git
cd Mica
npm install
npm run build
```

`npm install` fetches esbuild, the one development dependency, which minifies the build. Mica itself has no dependencies.

## Documentation

- [Getting started](docs/getting-started.md): opening Mica, your first program, the kernel's shell, where your work is kept, building from source.
- [User manual](docs/manual.md): every panel, control, setting and shortcut.
- [Instruction set](docs/instruction-set.md): the assembly language, the 33 instructions and the 38 System commands.
- [How it works](docs/architecture.md): the build, the layout of the code, the run loop and the rendering.
- [Troubleshooting](docs/troubleshooting.md): what to do when something does not look right.
- [Contributing](CONTRIBUTING.md) and the [changelog](CHANGELOG.md).

## How it works, in one paragraph

`mica.html` is built from five files in `src/`: the document head, the stylesheet, the markup, the examples and the app. The app is one script in fifteen sections. The assembler turns each line into an entry that already points at its instruction's handler, so the run loop is a tight `while` over an array; at full speed it runs in bursts of a few milliseconds and hands control back to the browser in between, so the page never freezes. Each instruction is a short JavaScript function kept as source text and compiled with `new Function`, which is how the CPU tab can show it and swap it while a program runs. The interface redraws once per frame and only what changed: the memory grid is a single canvas, the editors draw only the lines in view, and nothing that changes while a program runs is animated. `tools/build.mjs` minifies it all with esbuild into one file and stores the largest example compressed.

## Browsers

Mica needs Safari 16.4, Chrome or Edge 105, Firefox 113, or anything newer. Every change is tested in WebKit (Safari's engine) and in Chrome; Firefox is not covered by the automated tests yet. The page works from a `file://` address as well as from any web server, and on a phone or a narrow window the panels stack into a single column.

## Privacy and network use

Mica makes no network requests of its own: no fonts, scripts, analytics or update checks. The one exception is a command you type yourself, `BACKDROP url <link>`, which shows an image from that address, so your browser fetches it. Your settings, the three editors' text, the script library, a backdrop photo and a custom beep are kept in your browser's local storage, under keys that start with `mica:`. **Export** in the script library writes your scripts to a file of your choosing. Nothing else leaves your computer.

## License

Public domain. Mica is released under [The Unlicense](LICENSE): copy it, change it, sell it, build on it, no credit needed.
