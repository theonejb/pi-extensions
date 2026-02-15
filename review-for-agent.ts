import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const STATUS_KEY = "review-for-agent";
const LOCKFILE_NAME = ".review-for-agent.pi.lock";
const RFA_OUTPUT_DIR = "rfa/";
const LISTENING_RE = /Listening on\s+([^\s]+)/i;

interface LockfileData {
	ownerToken: string;
	repoRoot: string;
	piPid: number;
	childPid?: number;
	url?: string;
	startedAt: string;
}

function toHyperlink(url: string, label: string): string {
	return `\u001b]8;;${url}\u0007${label}\u001b]8;;\u0007`;
}

function parseReviewUrl(line: string): string | undefined {
	const match = line.match(LISTENING_RE);
	if (!match?.[1]) return undefined;

	const endpoint = match[1].trim();
	return `http://${endpoint}/review`;
}

function openBrowser(url: string): void {
	if (process.platform === "darwin") {
		spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
		return;
	}

	spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

function waitForExit(proc: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
	if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();

	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			proc.removeListener("exit", onExit);
			resolve();
		}, timeoutMs);

		const onExit = () => {
			clearTimeout(timer);
			resolve();
		};

		proc.once("exit", onExit);
	});
}

async function ensureRfaFilesExcluded(excludeFilePath: string): Promise<void> {
	let content = "";
	try {
		content = await fs.readFile(excludeFilePath, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") throw error;
	}

	const existingEntries = new Set(content.split(/\r?\n/).map((line) => line.trim()));
	const requiredEntries = [LOCKFILE_NAME, RFA_OUTPUT_DIR];
	const missingEntries = requiredEntries.filter((entry) => !existingEntries.has(entry));
	if (missingEntries.length === 0) return;

	const prefix = content.length === 0 || content.endsWith("\n") ? "" : "\n";
	const addition = `${prefix}# review-for-agent pi extension\n${missingEntries.join("\n")}\n`;
	await fs.mkdir(path.dirname(excludeFilePath), { recursive: true });
	await fs.appendFile(excludeFilePath, addition, "utf8");
}

export default function (pi: ExtensionAPI) {
	let repoRoot: string | undefined;
	let lockfilePath: string | undefined;
	let lockOwnerToken: string | undefined;
	let lockStartedAt: string | undefined;
	let reviewUrl: string | undefined;
	let processHandle: ChildProcessWithoutNullStreams | undefined;
	let ownsLock = false;
	let cleanupInProgress = false;
	let shuttingDownChild = false;

	function renderStatus(ctx: ExtensionContext): string | undefined {
		if (!ownsLock) return undefined;
		const theme = ctx.ui.theme;

		if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) {
			return `${theme.fg("warning", "●")} ${theme.fg("dim", "rfa stopped")}`;
		}

		if (!reviewUrl) {
			return `${theme.fg("accent", "●")} ${theme.fg("dim", "rfa starting...")}`;
		}

		const openLink = toHyperlink(reviewUrl, "open");
		return `${theme.fg("success", "●")} ${theme.fg("dim", "rfa")} ${openLink}`;
	}

	function refreshStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(STATUS_KEY, renderStatus(ctx));
	}

	async function writeLockfile(): Promise<void> {
		if (!ownsLock || !lockfilePath || !lockOwnerToken || !repoRoot || !lockStartedAt) return;

		const data: LockfileData = {
			ownerToken: lockOwnerToken,
			repoRoot,
			piPid: process.pid,
			childPid: processHandle?.pid,
			url: reviewUrl,
			startedAt: lockStartedAt,
		};

		await fs.writeFile(lockfilePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	}

	async function removeLockfileIfOwned(): Promise<void> {
		if (!ownsLock || !lockfilePath) return;

		try {
			const text = await fs.readFile(lockfilePath, "utf8");
			if (lockOwnerToken) {
				try {
					const parsed = JSON.parse(text) as Partial<LockfileData>;
					if (parsed.ownerToken && parsed.ownerToken !== lockOwnerToken) {
						return;
					}
				} catch {
					// If file is malformed, fall through and remove it since this session believes it owns the lock.
				}
			}

			await fs.rm(lockfilePath, { force: true });
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ENOENT") {
				console.error(`[review-for-agent] Failed to remove lockfile: ${(error as Error).message}`);
			}
		}
	}

	async function stopChildProcess(): Promise<void> {
		if (!processHandle) return;
		if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;

		shuttingDownChild = true;
		try {
			processHandle.kill("SIGTERM");
			await waitForExit(processHandle, 1500);

			if (processHandle.exitCode === null && processHandle.signalCode === null) {
				processHandle.kill("SIGKILL");
				await waitForExit(processHandle, 500);
			}
		} finally {
			shuttingDownChild = false;
		}
	}

	async function cleanup(ctx?: ExtensionContext): Promise<void> {
		if (cleanupInProgress) return;
		if (!ownsLock) return;

		cleanupInProgress = true;
		try {
			await stopChildProcess();
			await removeLockfileIfOwned();

			processHandle = undefined;
			reviewUrl = undefined;
			ownsLock = false;
			lockOwnerToken = undefined;
			lockfilePath = undefined;
			lockStartedAt = undefined;
			repoRoot = undefined;

			if (ctx?.hasUI) {
				ctx.ui.setStatus(STATUS_KEY, undefined);
			}
		} finally {
			cleanupInProgress = false;
		}
	}

	pi.registerCommand("rfa-open", {
		description: "Open review-for-agent in your browser",
		handler: async (_args, ctx) => {
			const gitRootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], { timeout: 3000 }).catch(() => undefined);
			if (!gitRootResult || gitRootResult.code !== 0) {
				if (ctx.hasUI) ctx.ui.notify("Not in a git repository", "warning");
				return;
			}

			const detectedRepoRoot = gitRootResult.stdout.trim().split(/\r?\n/).at(-1)?.trim();
			if (!detectedRepoRoot) {
				if (ctx.hasUI) ctx.ui.notify("Could not determine git repository root", "warning");
				return;
			}

			const candidateLockfile = path.join(detectedRepoRoot, LOCKFILE_NAME);
			let url: string | undefined;
			try {
				const text = await fs.readFile(candidateLockfile, "utf8");
				const parsed = JSON.parse(text) as Partial<LockfileData>;
				if (typeof parsed.url === "string" && parsed.url.trim().length > 0) {
					url = parsed.url.trim();
				}
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (ctx.hasUI) {
					if (code === "ENOENT") {
						ctx.ui.notify("No review-for-agent lockfile found for this repository", "warning");
					} else {
						ctx.ui.notify(`Failed to read lockfile: ${(error as Error).message}`, "error");
					}
				}
				return;
			}

			if (!url) {
				if (ctx.hasUI) ctx.ui.notify("Lockfile found, but review URL is not available yet", "warning");
				return;
			}

			try {
				openBrowser(url);
				if (ctx.hasUI) ctx.ui.notify(`Opened ${url}`, "info");
			} catch (error) {
				if (ctx.hasUI) {
					ctx.ui.notify(`Failed to open browser: ${(error as Error).message}`, "error");
				}
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		const gitRootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], { timeout: 3000 }).catch(() => undefined);
		if (!gitRootResult || gitRootResult.code !== 0) return;

		const detectedRepoRoot = gitRootResult.stdout.trim().split(/\r?\n/).at(-1)?.trim();
		if (!detectedRepoRoot) return;

		const binaryResult = await pi.exec("review-for-agent", ["--help"], { timeout: 3000 }).catch(() => undefined);
		if (!binaryResult || binaryResult.code !== 0) return;

		const excludePathResult = await pi
			.exec("git", ["-C", detectedRepoRoot, "rev-parse", "--git-path", "info/exclude"], { timeout: 3000 })
			.catch(() => undefined);
		if (excludePathResult && excludePathResult.code === 0) {
			const excludePathRaw = excludePathResult.stdout.trim().split(/\r?\n/).at(-1)?.trim();
			if (excludePathRaw) {
				const excludeFilePath = path.resolve(detectedRepoRoot, excludePathRaw);
				try {
					await ensureRfaFilesExcluded(excludeFilePath);
				} catch (error) {
					console.error(`[review-for-agent] Failed to update git exclude file: ${(error as Error).message}`);
				}
			}
		}

		const candidateLockfile = path.join(detectedRepoRoot, LOCKFILE_NAME);
		const ownerToken = randomUUID();
		const startedAt = new Date().toISOString();

		try {
			const handle = await fs.open(candidateLockfile, "wx");
			const initialData: LockfileData = {
				ownerToken,
				repoRoot: detectedRepoRoot,
				piPid: process.pid,
				startedAt,
			};
			await handle.writeFile(`${JSON.stringify(initialData, null, 2)}\n`, "utf8");
			await handle.close();
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "EEXIST") return;
			console.error(`[review-for-agent] Failed to create lockfile: ${(error as Error).message}`);
			return;
		}

		repoRoot = detectedRepoRoot;
		lockfilePath = candidateLockfile;
		lockOwnerToken = ownerToken;
		lockStartedAt = startedAt;
		ownsLock = true;
		reviewUrl = undefined;

		try {
			processHandle = spawn("review-for-agent", ["--no-open"], {
				cwd: repoRoot,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			console.error(`[review-for-agent] Failed to spawn process: ${(error as Error).message}`);
			await cleanup(ctx);
			return;
		}

		refreshStatus(ctx);
		await writeLockfile();

		let stdoutBuffer = "";
		processHandle.stdout.on("data", (chunk: Buffer) => {
			stdoutBuffer += chunk.toString("utf8");

			let newlineIndex = stdoutBuffer.indexOf("\n");
			while (newlineIndex >= 0) {
				const line = stdoutBuffer.slice(0, newlineIndex).trim();
				stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

				if (line.length > 0) {
					const parsedUrl = parseReviewUrl(line);
					if (parsedUrl && parsedUrl !== reviewUrl) {
						reviewUrl = parsedUrl;
						void writeLockfile();
						refreshStatus(ctx);
					}
				}

				newlineIndex = stdoutBuffer.indexOf("\n");
			}
		});

		processHandle.stderr.on("data", () => {
			// Keep stderr attached so process pipes do not block. We intentionally ignore text here.
		});

		processHandle.on("error", (error) => {
			if (cleanupInProgress || shuttingDownChild) return;
			console.error(`[review-for-agent] Process error: ${error.message}`);
			void cleanup(ctx);
		});

		processHandle.on("exit", async () => {
			processHandle = undefined;
			reviewUrl = undefined;

			if (cleanupInProgress || shuttingDownChild) return;

			if (ownsLock) {
				await removeLockfileIfOwned();
				ownsLock = false;
				lockOwnerToken = undefined;
				lockfilePath = undefined;
				lockStartedAt = undefined;
				repoRoot = undefined;
			}

			if (ctx.hasUI) {
				ctx.ui.setStatus(STATUS_KEY, `${ctx.ui.theme.fg("warning", "●")} ${ctx.ui.theme.fg("dim", "rfa stopped")}`);
			}
		});
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await cleanup(ctx);
	});
}
