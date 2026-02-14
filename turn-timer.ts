import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) {
		const seconds = ms / 1000;
		return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
	}

	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.floor((ms % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}

export default function (pi: ExtensionAPI) {
	let lastDurationMs: number | undefined;
	let activeTurnUserTimestamp: number | undefined;

	function resetState() {
		lastDurationMs = undefined;
		activeTurnUserTimestamp = undefined;
	}

	pi.on("session_start", async () => {
		resetState();
	});

	pi.on("session_switch", async () => {
		resetState();
	});

	pi.on("agent_start", async () => {
		activeTurnUserTimestamp = undefined;
	});

	pi.on("message_end", async (event) => {
		if ("role" in event.message && event.message.role === "user") {
			activeTurnUserTimestamp = event.message.timestamp;
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (activeTurnUserTimestamp !== undefined) {
			lastDurationMs = Math.max(0, Date.now() - activeTurnUserTimestamp);
		}

		if (ctx.hasUI && lastDurationMs !== undefined) {
			ctx.ui.notify(`Took ${formatDuration(lastDurationMs)}`, "info");
		}

		activeTurnUserTimestamp = undefined;
	});

	pi.registerCommand("turn-time", {
		description: "Show the latest measured turn time",
		handler: async (_args, ctx) => {
			if (lastDurationMs === undefined) {
				ctx.ui.notify("No completed turns yet.", "info");
				return;
			}

			ctx.ui.notify(`Last turn: ${formatDuration(lastDurationMs)}`, "info");
		},
	});
}
