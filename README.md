# pi-tps-counter

A lightweight [pi coding agent](https://github.com/earendil-works/pi-coding-agent) extension that measures LLM performance for the current session:

- **Decode speed** (tokens/second) — pure generation speed after the first token
- **TTFT** (Time To First Token) — latency from request start to first token

## Install / Usage

No build step required — just load the file as an extension:

```bash
pi --extension ./tps.ts
```

The status bar (footer) will show a live summary, e.g.:

```
decode 31.2 t/s  ttft 1.23s  n=12
```

### Commands

| Command | Description |
| --- | --- |
| `/tps` | Show detailed stats for this session |
| `/tps reset` | Clear all stats |

Example output of `/tps`:

```
LLM decode speed stats (this session)
  Requests:           12
  Total output tokens: 2560
  Total decode time:   82.10s
  Avg decode speed:    31.2 tok/s
  Avg TTFT:            1.23s (11/12 requests)
```

## How It Works

- Each assistant message reports its own `usage` (token counts) and `durationMs` (request duration, measured by pi on a monotonic clock).
- The `before_provider_request` extension event fires just before the provider HTTP call and provides the request start time (the `message_start` session event only fires after response headers arrive, so it cannot be used as the request start).
- The extension times the first content delta (`text_delta`, `thinking_delta`, or `toolcall_delta`) to get TTFT per request: request start → first token.
- Decode speed is computed as total output tokens over total time *after* the first token (`durationMs - TTFT`), so queueing/prefill time is excluded.
- The TTFT average only includes requests where a first token was actually observed; requests that fail or are interrupted before any token have no defined TTFT and are excluded from the average.

## Requirements

- pi coding agent (provides `ExtensionAPI`, `AssistantMessage` types at runtime)

## License

See [LICENSE](./LICENSE).
