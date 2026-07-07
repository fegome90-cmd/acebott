/**
 * arduino-cli wrapper for compiling sketches.
 *
 * Uses FQBN esp32:esp32:esp32 and a temp build path.
 */

import { spawn } from "node:child_process";
import { attachAbort } from "./abort.js";
import { FQBN } from "./constants.js";

export interface CompileOptions {
	sketchPath: string;
	buildPath: string;
	signal?: AbortSignal;
	onUpdate?: (progress: string) => void;
}

export interface CompileResult {
	success: boolean;
	stdout: string;
	stderr: string;
	buildPath: string;
}

/**
 * Compile an Arduino sketch using arduino-cli.
 *
 * @returns CompileResult with success status and output
 */
export function compileSketch(opts: CompileOptions): Promise<CompileResult> {
	return new Promise((resolve) => {
		const { sketchPath, buildPath, signal, onUpdate } = opts;

		const args = ["compile", "--fqbn", FQBN, "--build-path", buildPath, sketchPath];

		const proc = spawn("arduino-cli", args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		proc.stdout?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stdout += text;
			onUpdate?.(text.trim().split("\n").pop() ?? "");
		});

		proc.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		const cleanup = attachAbort(signal, proc);

		proc.on("error", (err) => {
			cleanup();
			resolve({
				success: false,
				stdout,
				stderr: `${stderr}\nSpawn error: ${err.message}`,
				buildPath,
			});
		});

		proc.on("close", (code) => {
			cleanup();
			resolve({
				success: code === 0,
				stdout,
				stderr,
				buildPath,
			});
		});
	});
}
