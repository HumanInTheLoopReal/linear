# Error handling

`linear` distinguishes two error tiers so that automation (headless agents,
CI) can react correctly instead of treating every failure the same.

## The two tiers

| Tier | Helper | Behaviour | When to use |
|------|--------|-----------|-------------|
| **Fatal** | `fatalError(message, { exitCode?, hint? })` | Printed as a JSON error envelope to stderr; process exits non-zero. | The command cannot complete its core purpose: bad input, missing precondition, an unrecoverable API failure. |
| **Warn** | `warnError(message, hint?)` | Printed to stderr as `Warning: …`; the process **does not exit**. | An auxiliary / optional step failed but the command's core result still stands (e.g. an optional metadata write, a best-effort hook). |

Both are constructed from the shared `LinearError` class
(`src/common/errors.ts`), which carries an `exitCode`, an optional `hint`, and a
`recoverable` flag. `handleCommand` (`src/common/output.ts`) routes them:

- `recoverable === true` (a `warnError`) → stderr warning, **no exit**.
- otherwise → `outputError`, which prints `{ error, hint? }` and exits with the
  error's `exitCode`.

**Agent-safe rule:** a warning must never block a headless agent. If a failure
is survivable, raise it with `warnError` so the command keeps going.

## Exit codes

| Code | Constant | Meaning |
|------|----------|---------|
| `1` | `EXIT_GENERIC` | Generic fatal error, **including user-input validation**. |
| `2` | `EXIT_VALIDATION` | Reserved for the single flag-conflict opt-in case (see below). |
| `3` | `EXIT_CONFLICT` | Optimistic-concurrency conflict: the server copy moved since the caller's baseline (`issues push`). Recovery: re-pull, re-apply, retry. |
| `42` | `AUTH_ERROR_CODE` | Authentication required/expired (`linear auth`). |

**Load-bearing rule:** user-input validation exits `1`, not `2`.
`invalidParameterError` and `requiresParameterError` exit `1`. Do **not**
introduce a blanket validation→`2` mapping — it silently breaks the command
tests that assert `exit(1)` on rejected input.

`EXIT_VALIDATION` (2) is reserved for exactly one situation: a
mutually-exclusive flag conflict. Use it only for that opt-in flag-conflict
guard, never as the default for "bad input".

Generic `Error`s thrown anywhere also map to exit `1`, so existing call sites
keep their behaviour.

## Hints

Any fatal error may carry a `hint` — a short actionable suggestion surfaced as a
`hint` field in the JSON envelope (and `Warning: msg (hint)` for warnings).
Prefer hints that name the exact next command, e.g.
`fatalError("no team resolved", { exitCode: EXIT_VALIDATION, hint: "pass --team <key> or set scope.team" })`.

## JSON shape

```json
{ "error": "no team resolved", "hint": "pass --team <key> or set scope.team" }
```

The `hint` key is omitted when no hint is attached.
