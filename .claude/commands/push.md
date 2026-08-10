---
description: Pushes changes from each panel's repo to GitHub
argument-hint: [commit message - optional]
allowed-tools: Bash, Read
---

# /push - push one repo

## Argument

`$ARGUMENTS` - commit message (optional).

- If provided - use the same message in every repo.
- If empty - for each repo, inspect `git status` and `git diff` and write a short, precise commit message **in English** that matches the changes (e.g. "feat: add tournament filter", "fix: login form error").

## Steps to execute

For each repo **sequentially**:

1. `git -C <repo> status --short` - check whether there are changes.
2. If there are **no** changes - skip this repo and report "client: no changes".
3. If there **are** changes, push them.
   - Do not ship everything in a single commit; split the changes into logical chunks and commit each one separately.
   - Review the diff and create a separate commit per change. Every commit message must be **in English** and follow the format `<prefix>: <short description>`. Allowed prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.

## At the end

Print a short report (one line per repo):

```
client : pushed  abc1234 feat: add tournament filter
server : pushed  def5678 fix: auth middleware error
```

## Rules

- **Never** use `--force`.
- **Never** bypass hooks with `--no-verify`.
- If a push is rejected - ask the user before running `git pull --rebase`.
- If the repo's branch is not `main`/`master` but a feature branch - just use the current branch name; do not switch branches.
- Commit messages are **in English**, and the prefix (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`) is also in English.
