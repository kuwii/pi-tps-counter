/**
 * TPS Counter Extension
 *
 * Tracks LLM decode speed (pure generation tokens/second) and TTFT
 * across the whole session.
 *
 * Data sources:
 * - Each assistant message (AssistantMessage) carries:
 *     usage      — token counts for that request (output includes the reasoning subset)
 *     durationMs — duration of that LLM request (ms, monotonic clock, measured by pi)
 * - before_provider_request fires just before each provider HTTP call; it
 *   provides the request start time. (message_start only fires after response
 *   headers arrive, so it cannot be used as the request start.)
 * - message_update events measure TTFT (latency from request start to first
 *   token). Decode speed = Σ output / Σ (durationMs − TTFT), i.e. only the
 *   generation phase after the first token is counted.
 * - The TTFT average only counts requests where a first token was actually
 *   observed (denominator alignment); requests that fail/abort before the
 *   first token have no defined TTFT and are excluded from the average.
 *
 * Usage:
 *   pi --extension ./tps.ts
 *   /tps        show details
 *   /tps reset  clear stats
 *
 * The status bar (footer) shows:  decode 31.2 t/s  ttft 1.23s  n=12
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";

interface Stats {
	/** Number of LLM requests */
	requests: number;
	/** Cumulative output tokens */
	outputTokens: number;
	/** Cumulative decode time after the first token (ms) */
	decodeMs: number;
	/** Cumulative TTFT (ms) */
	ttftMs: number;
	/** Number of requests where a first token was observed (TTFT mean denominator, aligned with ttftMs) */
	ttftSamples: number;
}

const newStats = (): Stats => ({ requests: 0, outputTokens: 0, decodeMs: 0, ttftMs: 0, ttftSamples: 0 });

function tps(tokens: number, ms: number): string {
	return ms > 0 ? (tokens / (ms / 1000)).toFixed(1) : "–";
}

function sec(ms: number): string {
	return (ms / 1000).toFixed(2) + "s";
}

// The footer renders its built-in lines (cwd, token stats) with the theme's "dim" token,
// while extension status text is rendered verbatim. Style with the same token via
// ctx.ui.theme (the live Theme instance pi exposes to extensions) so this line matches
// the rest of the footer exactly under any theme. The styled string is only refreshed on
// updates, so after a mid-session theme switch the line keeps the previous theme's color
// until the next update.
function dim(text: string, theme: Theme): string {
	return theme.fg("dim", text);
}

export default function (pi: ExtensionAPI) {
	let stats = newStats();
	// LLM calls in the agent loop are serial; at most one assistant message streams at a time
	let active: { startedAt: number; firstContentAt: number | null } | null = null;
	// Request start recorded from before_provider_request (fires just before the HTTP call,
	// unlike message_start which fires after response headers arrive). Consumed by the next
	// assistant message_start.
	let lastRequestStartAt: number | null = null;

	function updateStatus(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(
			"tps",
			stats.requests > 0
				? dim(
						`decode ${tps(stats.outputTokens, stats.decodeMs)} t/s ttft ${
							stats.ttftSamples > 0 ? sec(stats.ttftMs / stats.ttftSamples) : "–"
						} n=${stats.requests}`,
						ctx.ui.theme,
				  )
				: undefined,
		);
	}

	pi.on("before_provider_request", () => {
		lastRequestStartAt = performance.now();
	});

	pi.on("session_start", (_event, ctx) => {
		stats = newStats();
		active = null;
		lastRequestStartAt = null;
		updateStatus(ctx);
	});

	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") {
			active = { startedAt: lastRequestStartAt ?? performance.now(), firstContentAt: null };
			lastRequestStartAt = null;
		}
	});

	pi.on("message_update", (event) => {
		// First content delta = first token arrival
		if (active && active.firstContentAt === null) {
			const t = event.assistantMessageEvent.type;
			if (t === "text_delta" || t === "thinking_delta" || t === "toolcall_delta") {
				active.firstContentAt = performance.now();
			}
		}
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		const msg = event.message as AssistantMessage;
		const startedAt = active?.startedAt;
		const firstContentAt = active?.firstContentAt ?? null;
		active = null;

		// Prefer pi's built-in monotonic-clock measurement; fall back to our own when missing (legacy/deferred messages)
		const elapsedMs =
			msg.durationMs ?? (startedAt !== undefined ? performance.now() - startedAt : 0);

		stats.requests += 1;
		stats.outputTokens += msg.usage.output;
		if (firstContentAt !== null && startedAt !== undefined) {
			const ttft = Math.max(firstContentAt - startedAt, 0);
			stats.ttftSamples += 1;
			stats.ttftMs += ttft;
			stats.decodeMs += Math.max(elapsedMs - ttft, 0);
		}
		updateStatus(ctx);
	});

	pi.registerCommand("tps", {
		description: "Show LLM decode speed (tokens/second) and TTFT stats for this session; /tps reset to clear",
		handler: async (args, ctx) => {
			if (args.trim().toLowerCase() === "reset") {
				stats = newStats();
				active = null;
				updateStatus(ctx);
				ctx.ui.notify("TPS stats cleared", "info");
				return;
			}
			const lines = [
				"LLM decode speed stats (this session)",
				`  Requests:           ${stats.requests}`,
				`  Total output tokens: ${stats.outputTokens}`,
				`  Total decode time:   ${sec(stats.decodeMs)}`,
				`  Avg decode speed:    ${tps(stats.outputTokens, stats.decodeMs)} tok/s`,
				`  Avg TTFT:            ${stats.ttftSamples > 0 ? `${sec(stats.ttftMs / stats.ttftSamples)} (${stats.ttftSamples}/${stats.requests} requests)` : "–"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
