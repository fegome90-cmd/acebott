#!/usr/bin/env python3
"""
BLE GATT Client for Acebott QD001 Robot Control

Connects to QD001-BLE over Bluetooth Low Energy and sends motor commands.
Compatible with macOS (Core Bluetooth), Linux, Windows.

Usage:
    python ble_client.py                    # Interactive mode
    python ble_client.py --scan             # Scan for devices
    python ble_client.py --connect          # Connect and send test commands

Requirements:
    pip install bleak

Hardware: Acebott QD001 ESP32 MAX V1.0
Firmware: ble-gatt-control.ino
"""

import asyncio
import argparse
import sys
from bleak import BleakClient, BleakScanner

# Service and Characteristic UUIDs (must match firmware)
SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab"
COMMAND_UUID = "abcd1234-5678-90ab-cdef-1234567890ab"
TELEMETRY_UUID = "c8f60001-1234-5678-9abc-def012345678"

# Default device name
DEVICE_NAME = "QD001-BLE"


async def scan_for_devices(timeout=5.0):
    """Scan for BLE devices and return list."""
    print(f"Scanning for {timeout} seconds...")
    devices = await BleakScanner.discover(timeout=timeout)
    
    print(f"\nFound {len(devices)} devices:")
    for i, device in enumerate(devices):
        name = device.name or "Unknown"
        print(f"  [{i}] {name} | {device.address}")
    
    return devices


async def find_device(name=DEVICE_NAME, timeout=10.0):
    """Find specific device by name."""
    devices = await scan_for_devices(timeout)
    
    for device in devices:
        if device.name and name.lower() in device.name.lower():
            print(f"\nFound target device: {device.name} ({device.address})")
            return device
    
    print(f"\nDevice '{name}' not found!")
    return None


async def notification_handler(characteristic, data):
    """Handle telemetry notifications from robot."""
    value = data.decode('utf-8', errors='replace')
    parts = value.split(',')
    if len(parts) == 3:
        distance, ir_left, ir_right = parts
        print(f"  Telemetry: distance={distance}cm, IR_L={ir_left}, IR_R={ir_right}")
    else:
        print(f"  Telemetry: {value}")


async def connect_and_control(device):
    """Connect to device and send interactive commands."""
    print(f"\nConnecting to {device.name} ({device.address})...")
    
    async with BleakClient(device, timeout=10.0) as client:
        print(f"Connected: {client.is_connected}")
        
        # Discover services
        print("\nServices:")
        for service in client.services:
            print(f"  {service.uuid}")
            for char in service.characteristics:
                print(f"    {char.uuid} | {char.properties}")
        
        # Subscribe to telemetry notifications
        await client.start_notify(TELEMETRY_UUID, notification_handler)
        print("\nSubscribed to telemetry notifications")
        
        # Interactive command loop
        print("\nCommands: F=Forward, B=Backward, L=Left, R=Right, S=Stop")
        print("          F,200 = Forward at speed 200 (100-255)")
        print("          Q=Quit")
        print("-" * 40)
        
        while True:
            try:
                cmd = input("Command> ").strip().upper()
                
                if cmd == 'Q':
                    print("Disconnecting...")
                    break
                
                if not cmd:
                    continue
                
                # Send command
                await client.write_gatt_char(COMMAND_UUID, cmd.encode('utf-8'))
                print(f"  Sent: {cmd}")
                
            except KeyboardInterrupt:
                print("\nInterrupted")
                break
            except Exception as e:
                print(f"  Error: {e}")
        
        # Stop motors on disconnect
        await client.write_gatt_char(COMMAND_UUID, b'S')
        print("Motors stopped")


async def send_test_commands(device):
    """Send test commands to verify connectivity."""
    print(f"\nConnecting to {device.name}...")
    
    async with BleakClient(device, timeout=10.0) as client:
        print(f"Connected: {client.is_connected}")
        
        # Subscribe to telemetry
        await client.start_notify(TELEMETRY_UUID, notification_handler)
        
        # Test sequence
        commands = [
            ("F,150", "Forward at 150"),
            ("", "Wait 1s"),
            ("S", "Stop"),
            ("", "Wait 0.5s"),
            ("R,150", "Right at 150"),
            ("", "Wait 0.5s"),
            ("S", "Stop"),
        ]
        
        for cmd, desc in commands:
            print(f"\n  {desc}...")
            if cmd:
                await client.write_gatt_char(COMMAND_UUID, cmd.encode('utf-8'))
                print(f"    Sent: {cmd}")
            await asyncio.sleep(1.0)
        
        print("\nTest complete!")


async def main():
    parser = argparse.ArgumentParser(description="BLE GATT Client for QD001")
    parser.add_argument("--scan", action="store_true", help="Scan for devices")
    parser.add_argument("--connect", action="store_true", help="Connect interactively")
    parser.add_argument("--test", action="store_true", help="Send test commands")
    parser.add_argument("--name", default=DEVICE_NAME, help="Device name to search for")
    parser.add_argument("--timeout", type=float, default=10.0, help="Scan timeout in seconds")
    
    args = parser.parse_args()
    
    if args.scan:
        await scan_for_devices(args.timeout)
        return
    
    # Find device
    device = await find_device(args.name, args.timeout)
    if not device:
        sys.exit(1)
    
    if args.test:
        await send_test_commands(device)
    else:
        await connect_and_control(device)


if __name__ == "__main__":
    asyncio.run(main())
