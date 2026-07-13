"""
BLE Motor Controller for Acebott QD001 ESP32
Python client using bleak library for macOS/Linux/Windows

Usage:
    python3 ble_motor_controller.py

Commands:
    F,B,L,R,S = Forward, Backward, Left, Right, Stop
    F,200 = Forward at speed 200 (0-255)
    quit = Exit

Requirements:
    pip install bleak
"""

import asyncio
import struct
import sys
from bleak import BleakScanner, BleakClient

# === BLE UUIDs (must match ESP32 firmware) ===
SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214"
CHAR_COMMAND_UUID = "19b10002-e8f2-537e-4f6c-d104768a1214"
CHAR_TELEMETRY_UUID = "19b10001-e8f2-537e-4f6c-d104768a1214"

# === Telemetry struct (packed binary, matches ESP32) ===
TELEMETRY_FORMAT = "<HBBBxB"  # u16, u8, u8, u8, padding, u8
TELEMETRY_SIZE = struct.calcsize(TELEMETRY_FORMAT)


class BLEMotorController:
    def __init__(self):
        self.client = None
        self.connected = False
        self.telemetry = None

    def notification_handler(self, sender, data):
        """Handle incoming telemetry notifications."""
        if len(data) >= TELEMETRY_SIZE:
            distance, ir_left, ir_right, line_center, _, battery = struct.unpack(
                TELEMETRY_FORMAT, data[:TELEMETRY_SIZE]
            )
            self.telemetry = {
                "distance": distance,
                "ir_left": ir_left,
                "ir_right": ir_right,
                "line_center": line_center,
                "battery": battery,
            }
            # Print telemetry
            print(
                f"\r  Dist: {distance:4d}cm | IR: L={ir_left} R={ir_right} "
                f"| Line: {line_center:3d} | Batt: {battery}",
                end="",
                flush=True,
            )

    async def scan(self, timeout=5.0):
        """Scan for ESP32 BLE device."""
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
        print("Commands: F,B,L,R,S,F,200,B,100 etc.")
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
