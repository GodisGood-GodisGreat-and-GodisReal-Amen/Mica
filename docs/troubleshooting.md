# Troubleshooting

**Nothing is remembered between visits.**
Mica saves to the browser's local storage for the page's address. A private window throws it away when it closes, and some privacy settings clear site data when the browser quits. The online copy and a downloaded file have different addresses, so each has storage of its own, and so does each browser. To carry your scripts anywhere, use **Export** and **Import** in the script library (**Save**, or ⌘S).

**Choosing the kernel says "This example could not be opened in this browser".**
The kernel is stored compressed and unpacked by the browser, which needs Safari 16.4, Chrome or Edge 103, Firefox 113, or newer. Update the browser. The other examples work everywhere.

**I hear no sound.**
The RAM beep is off by default: turn it on in **Settings › RAM beep**, or with `SOUND sine` in the System tab. It plays on memory writes, so a program has to write memory (`STORE`, `PUSH`, `CALL`, or `MOV [x], …`). Browsers only start audio after you have clicked somewhere on the page. Check the beep's volume and the mute button next to it, and the computer's own volume.

**The program finishes before I can see anything, or crawls.**
That is the clock. 0 is instant; 180 ms, the default, lets you follow every instruction; anything from 60 ms up shows the register pulse. Each editor tab has its own clock, in its toolbar, and the footer shows the active tab's.

**The page seems stuck while a program runs.**
Mica keeps the page responsive even with an endless loop at an instant clock: press **Pause** or Esc. If the page really does not respond, a `JS` command in a System or Hybrid script may be looping forever; reload the page. Your program and settings are saved.

**Run does nothing, or the status reads SYNTAX.**
With **Strict run** on, Run refuses to start while the program has syntax errors; the TTY names the first one, and the red bar under the editor jumps to it. With an empty editor, the TTY says there is nothing to run.

**The status reads CRASHED.**
An instruction could not complete. The TTY shows the line and the reason, and the [instruction set](instruction-set.md#errors) lists every message. The usual ones: dividing by zero with the ÷0 guard on, recursion that never ends (*Stack overflow*), an address outside 0–1023, or a misspelt label (*Cannot resolve*).

**The status reads HALTED · PC OUT OF RANGE.**
The program ran past its last instruction, or jumped to an instruction number that does not exist. End your program with `HLT`.

**IN waits, and nothing I type is accepted.**
Type into the input row at the bottom of the TTY, which opens while the status reads AWAITING INPUT, and press Return. It takes a number (`42`, `-7`, `0x2A`, `0b101`) or a single character (`A` or `'A'`); anything else is refused with a hint.

**My changes to the program are not running.**
While a program is paused, edits take effect at the next Run from the top, or after **Reset**. Turn on **Settings › Live program** to have the editor assembled as you type.

**My patched instruction is back to the original.**
Patches made in the CPU tab last until the page is reloaded. Keep the code you want somewhere else, a saved script for example, and apply it again.

**The backdrop photo does not stick ("That image is too large to store").**
Local storage holds a few megabytes per site. Mica resizes photos to 2,560 pixels on their longest side, but a very detailed image can still be too large. Try a smaller or simpler picture.

**Part of a panel is cut off, or the page scrolls.**
On a short window the Editor and Machine panels keep the height they need and the page scrolls a little instead. Fold the manual with its chevron button, drag the dividers, or make the window taller. Double-click a divider to reset it.

**A panel is floating and I want it back in its place.**
Double-click its title bar. In the System tab, `SNAP all` puts every panel back.

**F10, Shift+F5 or / do nothing.**
These work outside text fields. Click outside the editor first. On a Mac keyboard, F10 may need the fn key. ⌘↩ (Ctrl+↩) works everywhere.

**The panels are not frosted like glass.**
The blur only shows over a photo, so Mica only applies it when there is a backdrop photo, or behind a floating panel. Over the plain gradient it would cost time without changing anything you can see.

**I want to start completely fresh.**
**Settings › Reset settings** restores every setting and keeps your programs and scripts. To remove everything Mica has stored, run this line in the System tab, then reload the page:

```
JS Object.keys(localStorage).filter(k => k.startsWith('mica:')).forEach(k => localStorage.removeItem(k))
```

It removes only Mica's own keys, which matters for a file opened from disk: some browsers keep one storage for every local file.

## Working on the code

**`npm test` says no Chrome, Chromium or Edge was found.**
Install one, or point `CHROME` at a browser binary: `CHROME=/path/to/chrome npm test`. On a Mac, `npm run test:webkit` runs the same tests in Safari's engine, with nothing else to install but the Xcode Command Line Tools for `swiftc`.

**`npm run check` says mica.html is not what src/ builds to.**
Something in `src/` changed after the last build. Run `npm run build` and commit `mica.html` along with your change.

**`npm run build` says esbuild is missing.**
Run `npm install` first. `npm run build:readable` builds an unminified `mica.html` without esbuild.
