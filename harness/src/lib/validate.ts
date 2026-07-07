/**
 * Input validation for harness parameters that reach shell/Python.
 *
 * Security: any value interpolated into a shell command or Python script
 * MUST pass through here first. Command injection is a CRITICAL risk.
 */

/** Regex for valid macOS USB-serial port paths. */
const PORT_PATTERN = /^\/dev\/cu\.usbserial[\w.-]*$/;

/**
 * Validate that a port string matches the expected macOS USB-serial pattern.
 * Throws if the port contains anything outside the allowed character set,
 * preventing command injection when interpolated into shell or Python.
 *
 * @example
 *   validatePort("/dev/cu.usbserial-110")   // OK
 *   validatePort("'; rm -rf /")             // throws PortValidationError
 */
export function validatePort(port: string): string {
	if (!PORT_PATTERN.test(port)) {
		throw new PortValidationError(`Invalid port "${port}". Must match /dev/cu.usbserial*`);
	}
	return port;
}

/**
 * Like validatePort but returns null instead of throwing.
 * Useful in detection flows where a missing/invalid port is normal.
 */
export function isValidPort(port: string): boolean {
	return PORT_PATTERN.test(port);
}

/** Error thrown when input validation fails. */
export class PortValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PortValidationError";
	}
}
