/**
 * Hardware constants for the Acebott QD001 ESP32 MAX V1.0.
 *
 * These values are verified against real hardware and the official
 * Acebott course materials. Do NOT change without hardware validation.
 */

// --- Arduino / ESP32 ---

/** Board FQBN for the generic ESP32 module (3 times, not arduino:esp32:esp32). */
export const FQBN = "esp32:esp32:esp32";

/** Serial baud rate — 115200 is the validated safe speed for CH340. */
export const BAUD = 115200;

// --- esptool (bundled with ACECode) ---

/** Path to the esptool binary bundled inside the ACECode.app package. */
export const ESPTOOL_PATH =
	"/Applications/ACECode.app/Contents/extraFiles-mac/compile/burner/esptool";

/** Flash offsets for ESP32 (from burner.js in ACECode). */
export const FLASH_OFFSETS = {
	bootloader: 0x1000,
	partitions: 0x8000,
	boot_app0: 0xe000,
	firmware: 0x10000,
} as const;

// --- CH340 chip identification ---

/** USB vendor/product IDs for the CH340/CH341 (WCH/Qinheng). */
export const CHIP = {
	vendorId: 0x1a86,
	productId: 0x7523,
	vendorName: "WCH",
} as const;

// --- GPIO pin map (from official course sketches) ---

/** QD001 GPIO pin assignments, extracted from the course Arduino sketches. */
export const PINS = {
	motors: "ACB_SmartCar_V2",
	ultrasonicTrig: 13,
	ultrasonicEcho: 14,
	servo: 25,
	ledLeft: 12,
	ledRight: 2,
	buzzer: 33,
	irReceiver: 4,
	trackingLeft: 35,
	trackingMiddle: 36,
	trackingRight: 39,
} as const;

// --- WiFi AP (factory firmware) ---

/** Default softAP credentials from the course firmware (4.3Web_control_car). */
export const AP = {
	ssid: "ESP32-Car",
	password: "12345678",
} as const;

// --- Serial ---

/** Hard timeout for serial reads (ms). */
export const SERIAL_TIMEOUT_MS = 10_000;
