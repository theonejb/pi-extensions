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
	let activeTurnUserTimestamp: number | undefined;

	function resetState() {
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
		if (ctx.hasUI && activeTurnUserTimestamp !== undefined) {
			const durationMs = Math.max(0, Date.now() - activeTurnUserTimestamp);
			ctx.ui.notify(`Took ${formatDuration(durationMs)}`, "info");
		}

		activeTurnUserTimestamp = undefined;
	});
}
