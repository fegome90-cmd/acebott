"""
Reference/binary-v2 BLE motor controller for a generic ESP32 robot.

This file is intentionally NOT the canonical QD001 firmware/client protocol.
The active QD001 stack uses sketches/ble-gatt-control/ble-gatt-control.ino and
scripts/ble_client.py with text-v1 UUIDs and CSV telemetry.

Usage:
    python3 ble_motor_controller.py

Commands:
    F,B,L,R,S = Forward, Backward, Left, Right, Stop
    T,Y = Spin left, spin right for the generic reference sketch
    F,200 = Forward at speed 200 (0-255)
    quit = Exit

Requirements:
    pip install bleak
"""

import asyncio
import struct
import sys
from dataclasses import dataclass

try:
    from bleak import BleakScanner, BleakClient
except ImportError:  # pragma: no cover - only needed for real BLE I/O
    BleakScanner = None
    BleakClient = None

# === Reference/binary-v2 BLE UUIDs (must match ble-motor-control-basic.ino) ===
SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214"
CHAR_COMMAND_UUID = "19b10002-e8f2-537e-4f6c-d104768a1214"
CHAR_TELEMETRY_UUID = "19b10001-e8f2-537e-4f6c-d104768a1214"

# === Telemetry struct (packed binary, exactly 6 bytes) ===
TELEMETRY_FORMAT = "<HBBBB"  # u16 distance + four u8 fields, no padding
TELEMETRY_SIZE = struct.calcsize(TELEMETRY_FORMAT)


@dataclass(frozen=True)
class BinaryTelemetry:
    distance: int
    ir_left: int
    ir_right: int
    line_center: int
    battery: int


def parse_telemetry(data: bytes) -> BinaryTelemetry:
    """Parse reference/binary-v2 telemetry packed by the generic ESP32 sketch."""
    if len(data) != TELEMETRY_SIZE:
        raise ValueError(f"expected {TELEMETRY_SIZE} telemetry bytes, got {len(data)}")
    distance, ir_left, ir_right, line_center, battery = struct.unpack(
        TELEMETRY_FORMAT, data
    )
    return BinaryTelemetry(distance, ir_left, ir_right, line_center, battery)


def require_bleak():
    if BleakScanner is None or BleakClient is None:
        raise SystemExit("Missing dependency: install bleak before using BLE I/O")


class BLEMotorController:
    def __init__(self):
        self.client = None
        self.connected = False
        self.telemetry = None

    def notification_handler(self, sender, data):
        """Handle incoming telemetry notifications."""
        telemetry = parse_telemetry(bytes(data))
        self.telemetry = {
            "distance": telemetry.distance,
            "ir_left": telemetry.ir_left,
            "ir_right": telemetry.ir_right,
            "line_center": telemetry.line_center,
            "battery": telemetry.battery,
        }
        print(
            f"\r  Dist: {telemetry.distance:4d}cm | "
            f"IR: L={telemetry.ir_left} R={telemetry.ir_right} "
            f"| Line: {telemetry.line_center:3d} | Batt: {telemetry.battery}",
            end="",
            flush=True,
        )

    async def scan(self, timeout=5.0):
        """Scan for ESP32 BLE device."""
        require_bleak()
        print(f"Scanning for QD001_Robot ({timeout}s)...")
        devices = await BleakScanner.discover(timeout=timeout)
        for d in devices:
            if d.name and "QD001" in d.name:
                print(f"Found: {d.name} ({d.address})")
                return d.address
        print("Device not found. Make sure ESP32 is advertising.")
        return None

    async def connect(self, address):
        """Connect to ESP32 BLE device."""
        print(f"Connecting to {address}...")
        self.client = BleakClient(address)
        await self.client.connect()
        self.connected = self.client.is_connected
        print(f"Connected: {self.connected}")

        if self.connected:
            # Subscribe to telemetry notifications
            await self.client.start_notify(
                CHAR_TELEMETRY_UUID, self.notification_handler
            )
            print("Telemetry notifications enabled (10Hz)")

    async def send_command(self, command):
        """Send motor command via Write Without Response."""
        if not self.connected or not self.client:
            print("Not connected!")
            return

        data = command.encode("utf-8")
        # Write Without Response (response=False) for low latency
        await self.client.write_gatt_char(
            CHAR_COMMAND_UUID, data, response=False
        )

    async def disconnect(self):
        """Disconnect from ESP32."""
        if self.client and self.connected:
            # Send stop command before disconnecting
            await self.send_command("S")
            await self.client.disconnect()
            self.connected = False
            print("Disconnected")

    async def interactive_mode(self):
        """Interactive command line mode."""
        print("\n=== BLE Motor Controller ===")
        print("Commands: F,B,L,R,S,T,Y,F,200,B,100 etc.")
        print("Type 'quit' to exit\n")

        loop = asyncio.get_event_loop()
        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        await loop.connect_read_pipe(lambda: protocol, sys.stdin)

        while self.connected:
            try:
                line = await asyncio.wait_for(reader.readline(), timeout=0.1)
                command = line.decode().strip()
                if command.lower() == "quit":
                    break
                if command:
                    await self.send_command(command)
                    print(f"  Sent: {command}")
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                print(f"Error: {e}")
                break


async def main():
    controller = BLEMotorController()

    try:
        # Scan for device
        address = await controller.scan()
        if not address:
            return

        # Connect
        await controller.connect(address)

        # Quick demo: move forward, then stop
        print("\nDemo: Moving forward...")
        await controller.send_command("F,150")
        await asyncio.sleep(2)
        await controller.send_command("S")
        print("Demo: Stopped")

        # Interactive mode
        await controller.interactive_mode()

    except KeyboardInterrupt:
        print("\nInterrupted")
    finally:
        await controller.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
