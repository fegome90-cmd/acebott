#!/usr/bin/env python3
"""
Canonical text-v1 BLE GATT client for Acebott QD001 robot control.

Matches sketches/ble-gatt-control/ble-gatt-control.ino:
- Device name: QD001-BLE
- Commands: ASCII text ("F,150", "B,150", "L,150", "R,150", or "S")
- Telemetry: UTF-8 CSV ("distance,ir_left,ir_right")
- Safety: commands are retransmitted every 200 ms while active so the firmware's
  500 ms failsafe does not stop motion mid-command; "S" is sent on exit.
"""

import argparse
import asyncio
import sys
from dataclasses import dataclass
from typing import Optional

try:
    from bleak import BleakClient, BleakScanner
except ImportError:  # pragma: no cover - exercised only on machines without bleak
    BleakClient = None
    BleakScanner = None


# Service and characteristic UUIDs for the canonical QD001 text-v1 firmware.
SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab"
COMMAND_UUID = "abcd1234-5678-90ab-cdef-1234567890ab"
TELEMETRY_UUID = "c8f60001-1234-5678-9abc-def012345678"

DEVICE_NAME = "QD001-BLE"
HEARTBEAT_INTERVAL_SECONDS = 0.2  # below the firmware's 500 ms failsafe


@dataclass(frozen=True)
class CsvTelemetry:
    distance_cm: int
    ir_left: int
    ir_right: int


def parse_csv_telemetry(data: bytes) -> CsvTelemetry:
    """Parse canonical text-v1 CSV telemetry: distance,ir_left,ir_right."""
    text = data.decode("utf-8", errors="strict").strip()
    fields = text.split(",")
    if len(fields) != 3:
        raise ValueError(f"expected 3 CSV fields, got {len(fields)}: {text!r}")
    distance, ir_left, ir_right = (int(field) for field in fields)
    return CsvTelemetry(distance, ir_left, ir_right)


def normalize_command(command: str) -> str:
    """Validate and normalize a canonical text-v1 command."""
    value = command.strip().upper()
    if not value:
        raise ValueError("empty command")

    parts = value.split(",", 1)
    op = parts[0]
    if op not in {"F", "B", "L", "R", "S"}:
        raise ValueError(f"unknown command {op!r}; expected F, B, L, R, or S")

    if op == "S":
        if len(parts) == 1:
            return op
        raise ValueError("stop command does not accept a speed")

    if len(parts) == 1:
        raise ValueError("movement commands require a comma and speed, e.g. F,150")

    if parts[1] == "" or not parts[1].isdigit():
        raise ValueError("speed must be numeric")

    speed = int(parts[1])
    if not 100 <= speed <= 255:
        raise ValueError("speed must be 100..255 for QD001 text-v1 firmware")
    return f"{op},{speed}"


def notification_handler(characteristic, data: bytearray):
    """Handle telemetry notifications from the canonical firmware."""
    try:
        telemetry = parse_csv_telemetry(bytes(data))
    except (UnicodeDecodeError, ValueError) as exc:
        print(f"  Telemetry parse error: {exc}")
        return

    print(
        "  Telemetry: "
        f"distance={telemetry.distance_cm}cm, "
        f"IR_L={telemetry.ir_left}, IR_R={telemetry.ir_right}"
    )


async def async_input(prompt: str) -> str:
    """Read one input line without blocking the asyncio event loop."""
    print(prompt, end="", flush=True)
    return await asyncio.to_thread(sys.stdin.readline)


async def write_command(client, command: str) -> None:
    """Write command using BLE Write Without Response."""
    await client.write_gatt_char(
        COMMAND_UUID,
        command.encode("utf-8"),
        response=False,
    )


class CommandHeartbeat:
    """Retransmit the active command until replaced or stopped."""

    def __init__(self, client, interval: float = HEARTBEAT_INTERVAL_SECONDS):
        self._client = client
        self._interval = interval
        self._active_command: Optional[str] = None
        self._changed = asyncio.Event()
        self._stopped = False

    @property
    def active_command(self) -> Optional[str]:
        return self._active_command

    async def set_command(self, command: str) -> None:
        normalized = normalize_command(command)
        self._active_command = normalized
        self._changed.set()
        await write_command(self._client, normalized)

    async def stop(self) -> None:
        self._active_command = "S"
        self._stopped = True
        self._changed.set()
        await write_command(self._client, "S")

    async def run(self) -> None:
        while not self._stopped:
            try:
                await asyncio.wait_for(self._changed.wait(), timeout=self._interval)
                self._changed.clear()
            except asyncio.TimeoutError:
                pass

            if self._active_command and self._active_command != "S":
                await write_command(self._client, self._active_command)


async def scan_for_devices(timeout: float = 5.0):
    """Scan for BLE devices and return the discovered list."""
    require_bleak()
    print(f"Scanning for {timeout} seconds...")
    devices = await BleakScanner.discover(timeout=timeout)

    print(f"\nFound {len(devices)} devices:")
    for i, device in enumerate(devices):
        name = device.name or "Unknown"
        print(f"  [{i}] {name} | {device.address}")

    return devices


async def find_device(name: str = DEVICE_NAME, timeout: float = 10.0):
    """Find a device by advertised name."""
    devices = await scan_for_devices(timeout)

    for device in devices:
        if device.name and name.lower() in device.name.lower():
            print(f"\nFound target device: {device.name} ({device.address})")
            return device

    print(f"\nDevice '{name}' not found!")
    return None


async def connect_and_control(device):
    """Connect to the QD001 and run interactive command mode."""
    print(f"\nConnecting to {device.name} ({device.address})...")

    async with BleakClient(device, timeout=10.0) as client:
        print(f"Connected: {client.is_connected}")

        print("\nServices:")
        for service in client.services:
            print(f"  {service.uuid}")
            for char in service.characteristics:
                print(f"    {char.uuid} | {char.properties}")

        await client.start_notify(TELEMETRY_UUID, notification_handler)
        print("\nSubscribed to telemetry notifications")

        print("\nCommands: F,150=Forward, B,150=Backward, L,150=Spin Left, R,150=Spin Right")
        print("          S=Stop; speeds must be 100-255")
        print("          Q=Quit")
        print("-" * 40)

        heartbeat = CommandHeartbeat(client)
        heartbeat_task = asyncio.create_task(heartbeat.run())
        try:
            while True:
                line = await async_input("Command> ")
                cmd = line.strip()
                if cmd.upper() == "Q":
                    print("Disconnecting...")
                    break
                if not cmd:
                    continue
                try:
                    await heartbeat.set_command(cmd)
                    print(f"  Sent: {heartbeat.active_command}")
                except ValueError as exc:
                    print(f"  Invalid command: {exc}")
        except KeyboardInterrupt:
            print("\nInterrupted")
        finally:
            await heartbeat.stop()
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            print("Motors stopped")


async def send_test_commands(device):
    """Send a short test sequence with retransmit below the 500 ms failsafe."""
    print(f"\nConnecting to {device.name}...")

    async with BleakClient(device, timeout=10.0) as client:
        print(f"Connected: {client.is_connected}")
        await client.start_notify(TELEMETRY_UUID, notification_handler)

        heartbeat = CommandHeartbeat(client)
        heartbeat_task = asyncio.create_task(heartbeat.run())
        try:
            for command, duration, desc in [
                ("F,150", 1.0, "Forward at 150"),
                ("S", 0.5, "Stop"),
                ("R,150", 0.5, "Spin right at 150"),
                ("S", 0.2, "Stop"),
            ]:
                print(f"\n  {desc}...")
                await heartbeat.set_command(command)
                await asyncio.sleep(duration)
        finally:
            await heartbeat.stop()
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass

        print("\nTest complete!")


def require_bleak() -> None:
    if BleakClient is None or BleakScanner is None:
        raise SystemExit("Missing dependency: install bleak before using BLE I/O")


async def main():
    parser = argparse.ArgumentParser(description="Canonical BLE GATT client for QD001")
    parser.add_argument("--scan", action="store_true", help="Scan for devices")
    parser.add_argument("--connect", action="store_true", help="Connect interactively")
    parser.add_argument("--test", action="store_true", help="Send test commands")
    parser.add_argument("--name", default=DEVICE_NAME, help="Device name to search for")
    parser.add_argument("--timeout", type=float, default=10.0, help="Scan timeout in seconds")

    args = parser.parse_args()

    if args.scan:
        await scan_for_devices(args.timeout)
        return

    device = await find_device(args.name, args.timeout)
    if not device:
        sys.exit(1)

    if args.test:
        await send_test_commands(device)
    else:
        await connect_and_control(device)


if __name__ == "__main__":
    asyncio.run(main())
