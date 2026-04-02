# CLAUDE.md — PotholeDodger V2

> Read this file at the start of every session. It contains the rules, architecture, current state, and decisions for this project.

---

## The Rules

1. **Work = it runs.** A file is not done because it looks right. It is done when it demonstrably works. Prioritize correctness over elegance.
2. **One file at a time.** Write it, commit it, wait for confirmation it works. Only then move to the next file.
3. **No scope creep.** Do not add features, buttons, logic, or UI elements that were not explicitly agreed on. If an idea comes up mid-build, note it and park it.
4. **No rewrites without a branch.** Large changes go on a branch named `refactor-<subject>`. Small targeted fixes go directly to `main`.
5. **Test after confirm.** The user confirms a feature works manually first. Then a test is written to lock that behavior in permanently. Tests are never written speculatively.
6. **Fail loudly.** Scripts that produce no output or encounter errors must exit with a non-zero code. Silent failures are not acceptable.
7. **One approval request at a time.** Do not ask follow-up questions or propose the next step until the current one is confirmed done.