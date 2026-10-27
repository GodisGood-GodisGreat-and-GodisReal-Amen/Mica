# Getting started

This guide takes you from the download to your first program, then into the kernel's shell.

## 1. Requirements

| What | Why | Check |
| --- | --- | --- |
| **A current browser** | runs Mica: Safari 16.4, Chrome or Edge 105, Firefox 113, or newer | the browser's About window |
| **Node.js 22 or newer** (only to work on the code) | builds `mica.html` and runs the tests | `node --version` |
| **Chrome or Chromium** (only for the tests) | `npm test` drives it headless; on a Mac, `npm run test:webkit` uses Safari's engine instead | |

To use Mica you need only the browser.

## 2. Get Mica

Download `mica.html` from the [latest release](https://github.com/GodisGood-GodisGreat-and-GodisReal-Amen/Mica/releases/latest). If you clone the repository instead, the same file is at its root, always built from the current source.

## 3. Open it

Double-click `mica.html`. It opens in your default browser as a local file: there is nothing to install and no server to start. You can also drag the file onto a browser window, or put it on any web server or static host and open it from there.

Mica remembers your programs and settings in the browser's storage for the page's address. A copy served from somewhere else, or opened in another browser, has storage of its own and starts fresh (section 7 has the details).

## 4. Your first program

Mica opens on the *counter* example:

```asm
; count from 1 to 5
MOV R1, 1
MOV R2, 5

loop:
OUT R1
INC R1
CMP R1, R2
JLE loop

HLT
```

1. Press **Run** (or ⌘↩; Ctrl+↩ on Windows and Linux). The numbers 1 to 5 appear in the TTY at the bottom right, and the status in the header turns to HALTED. It takes about four seconds, because the clock is set to 180 ms per instruction and the counter runs 23 instructions.
2. Drag the **Clock** slider to its left end, or type 0 in the field next to it: 0 means instant. Press **Run** again, and it is done before you can see it.
3. Press **Reset**, then **Step** (F10) a few times. Each press runs one instruction. The next line to run is highlighted, the header shows it with the values of its operands, and the registers that change pulse.
4. Click the line number of `INC R1`. A red dot marks a breakpoint. Press **Run**, and the program stops there each time round the loop, with the Run button reading **Resume**. Click the dot again to remove it, or press **Clear breaks**.
5. Change the program: replace `MOV R2, 5` with `MOV R2, 10` and press **Run**. It counts to ten. The Example menu now reads *your program*, and your text is saved as you type.

## 5. Look inside

- Click **R1** in the Machine panel, type a number and press Return. You have just changed a register.
- Click a memory cell and type a value. Hover over a cell to see its address.
- Open the **CPU** tab, click **INC**, change `+ 1` to `+ 2` and press **Apply**. Run the counter again: it prints 1, 3, 5. Press **Reset** in that card to put the original instruction back.

The [instruction set](instruction-set.md) describes the whole language, and the [user manual](manual.md) every control.

## 6. Try the kernel

Choose **★ kernel — shell + stdlib** in the Example menu, set the clock to 0 and press **Run**. MSH, the Mica shell, prints its banner and waits in the TTY:

```
============================================
    MSH - Mica Shell v1
    type ? for help, q to quit
============================================
msh>
```

Type a one-character command and press Return. A command that needs numbers asks for them one at a time. `?` lists them all:

```
  arithmetic  + - * / %
  bitwise     & | ^ ~ < >
  math        ! f g
  io          b r o s
  vars        = @
  meta        ? q
  mpl         p x c l
```

Try `+` to add two numbers, `f` for the first *n* Fibonacci numbers, `g` for a greatest common divisor, `b` to see a number in decimal, hex and binary, `s` to sort a few numbers, or `=` and `@` to store a value in one of ten variables and read it back. `p` enters a program in MPL, the shell's own tiny stack language, `x` runs it and `l` lists it. `q` says goodbye and halts the CPU.

Whenever the TTY asks for a value, you can type `42`, `-7`, `0x2A`, `0b101010`, or a character such as `A` or `'A'`, which gives its character code.

The kernel is an ordinary Mica program of about 1,900 lines. Scroll through it to see how a shell, a number printer, a sort and a small virtual machine are written with 33 instructions.

## 7. Where your work is kept

Everything is saved in your browser's local storage, under keys that start with `mica:`: the settings, the text of the three editors, and the script library. Nothing is sent anywhere.

- **Save** (⌘S) keeps the current script in the library. **Export**, in the same dialog, writes the whole library to a file, and **Import** merges such a file back, in any browser.
- Clearing the browser's data for the page, or using a private window, starts Mica fresh.
- **Settings › Reset settings** restores every default and keeps your programs and scripts.

## 8. Updating

Download the new `mica.html` and put it where the old one was, under the same name. Opened from the same address, it finds your work where the old one left it. If you move it, carry your scripts across with **Export** and **Import**. In a clone, `git pull` brings the new `mica.html`.

## 9. Building from source

```bash
npm install              # esbuild, the one development dependency
npm run build            # src/ → mica.html, minified
npm run build:readable   # the same without minification, for debugging
npm run check            # syntax, mica.html up to date, version, links
npm test                 # the browser tests, in headless Chrome
npm run test:webkit      # the same tests in WebKit (macOS)
```

[CONTRIBUTING.md](../CONTRIBUTING.md) explains the layout of the code and its conventions.
