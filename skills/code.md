
---
name: ichnoscope-backend
description: Use when writing or changing any Python file in backend/ichnoscope/ (models, parse, blame, explain, llm, severity, templates, dispatch, pipeline, replay) or its tests. Defines the project rules, the one-file-at-a-time workflow, and where each module is specified.
---

# Ichnoscope backend coding skill

## What the project does (one paragraph)
Ichnoscope receives a production error (Sentry payload), finds the commit that last changed the failing line **at the deployed release SHA**, asks an LLM to explain the failure from that evidence, and drafts a GitHub issue for a human to approve. It is read-only: it never pushes code, opens PRs or rolls anything back.

## The one rule that overrides everything
**Code gathers evidence. The LLM only explains it.**
- `Incident` and `Culprit` are built by deterministic code only.
- The LLM returns only an `Explanation` (domain, hypothesis, exactly 3 checklist items).
- The LLM never produces a commit SHA, GitHub login or severity. Severity comes from `severity.py`.

## Source of truth
Read these before writing code. If a file is empty or contains only a comment line, **stop and tell the user**. Do not guess its contents.

| Need | Read |
| --- | --- |
| Whole design, principles, decisions | `docs/TECHNICAL_SPEC.md` sections 1 to 3 and 12 |
| Data models | section 4.1 |
| Function signatures for every module | section 4.2 |
| Blame algorithm and GraphQL query | section 4.3 |
| Severity rules | section 4.4 |
| LLM prompt and fallback behaviour | section 4.5 |
| Issue template, assignee and label rules | section 4.6 |
| API and webhook | section 5 |
| Config variables | section 7 |
| Security rules | section 8 |
| Failure behaviour | section 9 |
| Test plan | section 10 |
| Pipeline picture | `docs/architecture.md` (Mermaid) |

If the code and the spec disagree, **follow the spec and say so**. If the spec is wrong or missing something, propose the change and wait. Do not silently diverge.

## Workflow: one file per task
1. Restate the task in one sentence and list the exact files you will create or edit.
2. Read the relevant spec sections.
3. Write the file and its test file. **Touch nothing else.**
4. Run `pytest <test file> -q`, then `ruff check backend` if available. Paste the real output.
5. Reply with: files changed (`git status --short`), test output, and any deviation from the spec with the reason.
6. **Stop and wait for review.** Never start the next module on your own.

## Coding rules
- Python 3.11+, type hints on every function, Pydantic v2 for data models.
- Plain functions and small modules. **No LangGraph, LangChain, classes-for-the-sake-of-classes or global state.**
- **No network calls, env reads or file I/O at import time.** Read config lazily inside functions through `config.py`.
- All external calls (GitHub, LLM) are wrapped in one small function per call, with timeouts (15 to 20 s) and `tenacity` retries only where the spec says so. This makes them easy to mock.
- Every external dependency has a **stub mode** controlled by config (`USE_STUB_GITHUB`, `USE_STUB_LLM`). Tests never hit the network.
- Never log or print tokens, API keys or full diffs. Run `redact.py` before anything is posted or stored.
- Treat everything from Sentry, commits and the LLM as **untrusted input**. Validate with Pydantic. When parsing fails, degrade (fallback template) instead of raising to the user.
- Truncate long text with the limits in the spec (stack excerpt 4000 chars, diff 6000 chars).
- Timestamps are timezone-aware UTC `datetime`, never strings or naive values.
- Naming: `snake_case` functions, `PascalCase` models, constants in `UPPER_CASE`.
- Each module starts with a one-line docstring saying what it does and who calls it.

## Testing rules
- `pytest`, files named `tests/test_<module>.py`.
- Test the happy path, each failure path in spec section 9 that the module owns, and boundary values.
- Mock GitHub and the LLM. Use the files in `fixtures/` for Sentry payloads.
- A bug found later gets a regression test first, then the fix.

## Definition of done (per file)
- [ ] Matches the spec's signatures and field names exactly.
- [ ] Tests written and passing, output pasted.
- [ ] `ruff check` clean (or reported if ruff is unavailable).
- [ ] No unrelated files changed.
- [ ] No secrets, no import-time side effects.
- [ ] Deviations from the spec listed, or "none".

## Do not
- Do not add dependencies without asking.
- Do not rename fields in `models.py` after they are approved. The frontend and dashboard depend on them.
- Do not implement features marked "later" (dedupe, Slack, live gateway) unless the task says so.
- Do not claim something works without running it.