# Notes for AI assistants

Read [CONTRIBUTING.md](CONTRIBUTING.md) first: everything in it applies to you. On top of it:

- **Fixed bugs stay fixed.** [test/fixed-bugs.md](test/fixed-bugs.md) lists every fixed bug with the check in `test/suite.js` that guards it, and `npm run check` fails if one goes missing. Never delete, skip or loosen one of those checks to make a change pass. Make the change you were asked for; if it truly needs a guarded behaviour to work differently, change that check on purpose, update its line in `test/fixed-bugs.md`, and say so in the commit message and to the person who asked.
- **When you fix a bug**, write its check first and run it against the old build to see it fail, then fix, rebuild and see it pass. Add the bug to `test/fixed-bugs.md` and a line to `CHANGELOG.md`.
- **Before you commit**, run `npm run build`, `npm run check`, `npm test` and, on a Mac, `npm run test:webkit`. All of them must pass, and the rebuilt `mica.html` goes in the same commit.
- **Commit or push only when asked.** A push to `main` that passes the checks on GitHub publishes the website.
