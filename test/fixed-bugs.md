# Fixed bugs

Every bug fixed in Mica is listed here with the check in [`suite.js`](suite.js) that would have caught it. `npm run check` fails when one of these checks is missing from the suite, so a later change cannot quietly bring a bug back.

Never delete or loosen one of these checks to make a change pass. If a change really needs one of these behaviours to work differently, change its check on purpose, update its line here, and say why in the commit message.

| Fixed | Bug | Check |
| --- | --- | --- |
| 2026-11-01 | In MPL, the kernel's stack language, `7 0 /` left the 7 on the stack under the 0. | `MPL divides by zero to 0 and keeps the stack balanced` |
| 2026-11-01 | On a Mac set to always show scroll bars, line numbers and coloured code ran under the editor's horizontal scroll bar: the end of a long script looked cut off and the last numbers seemed not to match their lines. With Safari's Zoom Text Only, every number drifted off its line. | `line numbers and colours stay on their lines down to the last one` |
