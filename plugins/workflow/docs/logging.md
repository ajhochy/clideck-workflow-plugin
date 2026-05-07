# Workflow Plugin: Operational Reference

## Logging

All log files are written under `{workflowDir}/logs/`. The directory is created automatically on first use.

Every logger call is **best-effort**: failures are silently swallowed and never propagate into the runner.

### Files

| File | Format | Contents |
|------|--------|----------|
| `events.log` | JSONL | Workflow-wide event stream. Every `logger.event()` call appends one JSON line regardless of stage. |
| `{stage}.log` | JSONL | Per-stage event stream. Same data as `events.log` but filtered to a single stage. |
| `{stage}.prompt.log` | Plain text | Full prompts sent to agents for that stage. Each prompt is written as a delimited section (`--- prompt ---` header + body). Useful for debugging agent inputs. |
| `errors.log` | JSONL | Error records from `logger.error()`. Each line includes a `stack` field with the full stack trace. |
| `{stage}-session-{sid}.log` | Plain text | Raw stdout/stderr from an individual agent session. Each file opens with a header marker and closes with a footer marker written by `openSessionStream().close()`. Calling `close()` more than once is safe — the footer is written exactly once. |

---

## Summary Versioning

Each workflow folder accumulates one summary file per run. The scheme avoids overwrites:

1. **First write** — file is named `summary.md`.
2. **Second write** — file is named `summary.run2.md`. `summary.md` is left untouched.
3. **Third write** — `summary.run3.md`, and so on.

Gaps in the sequence are tolerated (e.g. `run3` can exist without `run2`). The next filename is determined by scanning for the highest existing run number and incrementing.

In addition to the workflow-folder copy, a project-repo-namespaced copy is written to:

```
.clideck-workflow/summaries/{workflowId}-summary.md
```

This path lives inside the target repository so that multiple concurrent workflows against the same repo produce separate summary files without colliding.

---

## Smoketest Authoring

The `planning` stage is responsible for producing the smoketest document. It does so in **Phase 6**, just before writing the completion signal marker. The output is written to:

```
{workflowDir}/smoketest.md
```

The `smoketest` stage consumes this file rather than generating it. It loads `smoketest.md` at startup, executes the checklist (including any cross-app checks), and writes its result marker when finished. If `smoketest.md` is absent when the smoketest stage runs, the stage should treat it as a configuration error rather than generating a new checklist from scratch.
