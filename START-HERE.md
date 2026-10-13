# GovServe Claude Code starter kit

Drop these files into an empty repository, then build GovServe one phase at a time with Claude Code.

## 1. Set up (once)

```bash
# Install Claude Code (macOS/Linux/WSL). Windows PowerShell: irm https://claude.ai/install.ps1 | iex
curl -fsSL https://claude.ai/install.sh | bash
claude --version && claude doctor

# Tools Claude drives: git, gh (then `gh auth login`), Node 22 LTS, pnpm, Docker, jq

mkdir govserve && cd govserve && git init
# copy the contents of this kit here (including the hidden .claude folder and dotfiles)
git add -A && git commit -m "chore: claude code starter kit"
```

## 2. What's in the kit

| Path | Purpose |
| --- | --- |
| `CLAUDE.md` | Short project brief loaded every session |
| `.claude/settings.json` | Enforced permissions (deny `.env` reads, force-push, prod deploys) + Prettier hook |
| `.claude/rules/` | Backend, frontend, testing rules that load only for matching files; security rules always |
| `.claude/skills/phase` | `/phase 04` runs `docs/prompts/phase-04.md` with plan-then-approve |
| `.claude/skills/ship` | `/ship` verifies, updates PROGRESS.md, commits (no push) |
| `.claude/skills/nest-module` | Conventions for new NestJS modules |
| `.claude/skills/review` | `/review` checks the diff for security and spec gaps in the main session (no subagents) |
| `docs/SPEC.md` | Seed spec from your application brief; Phase 0 expands it |
| `docs/PROGRESS.md` | Phase checklist |
| `docs/prompts/phase-00…12.md` | The 13 phase prompts |

No subagents, worktrees or parallel sessions: everything runs in one session at a time to keep token use low.

## 3. The loop for every phase

```bash
git checkout -b phase-00-spec
claude --permission-mode plan
```

```text
> /phase 00
  ...review the plan (Ctrl+G to edit it), approve...
> /clear
> /review
> fix the Critical and High findings only
> /ship
```

Then merge, `/clear` (or start a new terminal), and move to the next phase.

## 4. Keep token use low

- One phase per session, then `/clear`. Don't resume old long sessions; SPEC.md and PROGRESS.md carry the context.
- `/model`: Sonnet for routine phases (1, 3, 7, 8, 9, 11), Opus for 0, 2, 5, 10, 12.
- Point at files with `@path` and narrow greps; never ask Claude to "explore the codebase".
- Split big phases (e.g. 5 into 5a fees, 5b payments, 5c receipts), one session each.
- `/compact <focus>` before context fills; check `/context` and `/usage` before a big phase.
- Avoid features that fan out into extra agents: subagents, `/code-review`, workflows, `/batch`, agent teams.

The prompts are already tailored to the decisions in `docs/DECISIONS.md` (USD only, officer-confirmed
mobile money/bank/cash, gateway-confirmed cards, English, email notifications, individual citizens only, three pilot services: proof of address,
police clearance and birth certificate, detailed in `docs/SERVICES.md`).
Phase 0's interview confirms every 'Confirm' item in SERVICES.md (authorities, fees, documents, in-person steps),
plus the supervisor threshold and permissions. Gather the official fees and requirements before you start it.
Confirm the hosting target before Phase 11.
