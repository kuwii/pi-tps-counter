# AGENTS.md

## Project Overview

`pi-tps-counter` is a single-file extension for the pi coding agent (`@earendil-works/pi-coding-agent`). It tracks LLM performance metrics for the current session:

- **Decode speed** (tokens/second) — measured only after the first token arrives
- **TTFT** (Time To First Token) — latency from request start to first content delta

The extension runs as `tps.ts` at the repo root. There is no build step, no package.json, no tests.

## How It Works

- `before_provider_request` fires just before the provider HTTP call and provides the request start time (`message_start` only fires after response headers arrive, so it cannot be used as the request start).
- `message_update` captures the first content delta (`text_delta`, `thinking_delta`, or `toolcall_delta`) as the first-token arrival; TTFT = first-token time − request start.
- `message_end` uses `msg.durationMs` (pi's built-in monotonic-clock measurement) and `msg.usage.output` to accumulate stats. `durationMs - TTFT` is the pure decode time.
- LLM calls in the agent loop are serial, so a single `active` variable is sufficient (at most one assistant message is streaming at a time).
- TTFT average uses denominator alignment: only requests where a first token was actually observed count toward the TTFT mean.

## Conventions

- **All code, comments, documentation, and user-facing output must be in English.**
- **Any change must also update any inconsistent places in both `AGENTS.md` and `README.md`**, keeping them in sync with the code.

- Plain TypeScript with type-only imports from `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` (types are provided by pi at runtime; no local deps).
- Stats live in module-level state, reset on `session_start` and `/tps reset`.
- Keep changes minimal and self-contained in `tps.ts`; do not add build tooling unless asked.
