/**
 * USB chip detection via ioreg with system_profiler fallback.
 *
 * Decision (OQ-1 from design): ioreg is more stable across macOS
 * versions and faster than system_profiler.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { CHIP } from "./constants.js";

const execAsync = promisify(exec);

export interface ChipInfo {
	vendor: string;
	vendorId: string;
	productId: string;
}

/**
 * Detect the CH340/CH341 USB-serial chip.
 *
 * Tries ioreg first (faster, stable format), falls back to
 * system_profiler if ioreg yields nothing.
 *
 * @returns ChipInfo if CH340 detected, null otherwise
 */
export async function detectChip(): Promise<ChipInfo | null> {
	const ioregResult = await tryIoreg();
	if (ioregResult) return ioregResult;

	const profileResult = await trySystemProfiler();
	if (profileResult) return profileResult;

	return null;
}

async function tryIoreg(): Promise<ChipInfo | null> {
	try {
		const { stdout } = await execAsync("ioreg -r -c IOUSBHostDevice -l", {
			timeout: 5000,
		});

		// ioreg output has entries like:
		//   "idVendor" = 6790
		//   "idProduct" = 29987
		// We parse for the CH340 vendor ID (6790 = 0x1A86)
		const lines = stdout.split("\n");
		let inCh340Block = false;
		let productId: number | null = null;

		for (const line of lines) {
			if (line.includes("IOUSBHostDevice")) {
				inCh340Block = false;
			}
			const vendorMatch = line.match(/"idVendor"\s*=\s*(\d+)/);
			if (vendorMatch) {
				const vid = parseInt(vendorMatch[1], 10);
				inCh340Block = vid === CHIP.vendorId;
			}
			const productMatch = line.match(/"idProduct"\s*=\s*(\d+)/);
			if (productMatch && inCh340Block) {
				productId = parseInt(productMatch[1], 10);
				if (productId === CHIP.productId) {
					return {
						vendor: CHIP.vendorName,
						vendorId: `0x${CHIP.vendorId.toString(16).toUpperCase()}`,
						productId: `0x${productId.toString(16).toUpperCase()}`,
					};
				}
			}
		}
		return null;
	} catch {
		return null;
	}
}

async function trySystemProfiler(): Promise<ChipInfo | null> {
	try {
		const { stdout } = await execAsync("system_profiler SPUSBDataType -json", {
			timeout: 10_000,
		});
		const data = JSON.parse(stdout);
		return findCh340InJson(data);
	} catch {
		return null;
	}
}

interface USBItem {
	vendor_id?: string;
	product_id?: string;
	_name?: string;
	_items?: USBItem[];
}

function findCh340InJson(data: Record<string, unknown>): ChipInfo | null {
	const search = (items: USBItem[]): ChipInfo | null => {
		for (const item of items) {
			const vid = item.vendor_id ?? "";
			const pid = item.product_id ?? "";
			if (
				vid.includes(CHIP.vendorId.toString(16)) ||
				vid.includes(`0x${CHIP.vendorId.toString(16)}`)
			) {
				return {
					vendor: CHIP.vendorName,
					vendorId: `0x${CHIP.vendorId.toString(16).toUpperCase()}`,
					productId: pid.split(" ")[0] || `0x${CHIP.productId.toString(16).toUpperCase()}`,
				};
			}
			if (item._items) {
				const nested = search(item._items);
				if (nested) return nested;
			}
		}
		return null;
	};

	const dataType = data.SPUSBDataType as USBItem[] | undefined;
	if (dataType) return search(dataType);
	return null;
}
