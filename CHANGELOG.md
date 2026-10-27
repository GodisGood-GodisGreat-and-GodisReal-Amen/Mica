# Changelog

## 1.0.0 — 2026-10-28

The first public release.

- **A small, complete CPU**: four registers, a program counter, a stack pointer, two flags, 1,024 memory cells and 33 instructions, with `JZ` and `JNZ` as aliases.
- **An editor that knows the language**: syntax highlighting, a syntax check as you type, breakpoints on the line numbers, and seven examples, among them a 1,900-line kernel with a command shell and a tiny stack language of its own.
- **Any speed**: instant, a clock from 1 ms to 2 s per instruction, or one step at a time. Flat out, the CPU runs millions of instructions a second in short bursts, so the page stays responsive even in an endless loop.
- **Everything visible and editable**: registers, flags and every memory cell can be read and changed at any time; the memory grid marks the stack, the stack pointer and the last write, and works from the keyboard and with screen readers.
- **A CPU you can rewrite**: each instruction's JavaScript can be edited and applied while a program runs.
- **System and Hybrid tabs**: 38 host commands that drive the machine from outside, and scripts that mix them with assembly.
- **A script library** with export and import, light and dark themes, a backdrop photo, a RAM beep, and panels that resize, float and swap places.
- **One file of about 170 KB**, with no dependencies and no network requests, tested on every change in Chrome and in WebKit.
