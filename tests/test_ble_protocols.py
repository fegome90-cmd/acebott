import asyncio
import importlib.util
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


ble_client = load_module("ble_client", ROOT / "scripts" / "ble_client.py")
binary_client = load_module(
    "binary_ble_motor_controller",
    ROOT / "docs" / "references" / "ble_motor_controller.py",
)


def test_canonical_csv_telemetry_parser():
    telemetry = ble_client.parse_csv_telemetry(b"42,1,0")

    assert telemetry.distance_cm == 42
    assert telemetry.ir_left == 1
    assert telemetry.ir_right == 0


@pytest.mark.parametrize(
    ("raw", "normalized"),
    [
        ("f,150", "F,150"),
        ("r,200", "R,200"),
        ("S", "S"),
    ],
)
def test_canonical_command_normalization(raw, normalized):
    assert ble_client.normalize_command(raw) == normalized


@pytest.mark.parametrize(
    "raw",
    [
        "F",
        "Fjunk",
        "Rabc",
        "L,",
        "B,99",
        "R,256",
        "S,150",
    ],
)
def test_canonical_command_rejects_malformed_or_out_of_range_values(raw):
    with pytest.raises(ValueError):
        ble_client.normalize_command(raw)


def test_firmware_parser_requires_speed_for_movement_but_allows_stop():
    firmware_source = (
        ROOT / "sketches" / "ble-gatt-control" / "ble-gatt-control.ino"
    ).read_text()

    assert "if (*cmd == 'S')" in firmware_source
    assert "return rawCommand[1] == '\\0';" in firmware_source
    assert "if (rawCommand[1] != ',' || rawCommand[2] == '\\0')" in firmware_source
    assert "isdigit((unsigned char)*cursor)" in firmware_source


def test_binary_reference_telemetry_is_exactly_six_bytes():
    assert binary_client.TELEMETRY_SIZE == 6

    payload = bytes([0x34, 0x12, 1, 0, 127, 88])
    telemetry = binary_client.parse_telemetry(payload)

    assert telemetry.distance == 0x1234
    assert telemetry.ir_left == 1
    assert telemetry.ir_right == 0
    assert telemetry.line_center == 127
    assert telemetry.battery == 88


def test_binary_reference_telemetry_rejects_wrong_size():
    with pytest.raises(ValueError, match="expected 6 telemetry bytes"):
        binary_client.parse_telemetry(b"\x00" * 7)


class FakeBleClient:
    def __init__(self):
        self.writes = []

    async def write_gatt_char(self, uuid, data, response):
        self.writes.append((uuid, data, response))


def test_active_command_heartbeat_retransmits_without_response():
    async def scenario():
        client = FakeBleClient()
        heartbeat = ble_client.CommandHeartbeat(client, interval=0.05)

        task = asyncio.create_task(heartbeat.run())
        try:
            await heartbeat.set_command("F,150")
            await asyncio.sleep(0.12)
            await heartbeat.stop()
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        return client.writes

    client_writes = asyncio.run(scenario())

    writes = [write for write in client_writes if write[1] == b"F,150"]
    assert len(writes) >= 2
    assert all(write[2] is False for write in client_writes)
    assert client_writes[-1][1] == b"S"


def test_binary_reference_imports_sys_for_interactive_stdin():
    assert binary_client.sys is sys


def test_ios_binary_reference_requires_exact_six_byte_telemetry():
    swift_source = (ROOT / "docs" / "references" / "ios-ble-swift.swift").read_text()
    assert "guard data.count == 6 else { return nil }" in swift_source
    assert "guard data.count >= 6 else { return nil }" not in swift_source


def test_reference_spin_commands_are_documented_consistently():
    ino_source = (ROOT / "docs" / "references" / "ble-motor-control-basic.ino").read_text()
    python_source = (ROOT / "docs" / "references" / "ble_motor_controller.py").read_text()
    guide_source = (
        ROOT / "docs" / "references" / "ble-gatt-esp32-ios-robot-control.md"
    ).read_text()

    assert "case 'T': spinLeft(speed);" in ino_source
    assert "case 'Y': spinRight(speed);" in ino_source
    assert "T,Y = Spin left, spin right" in python_source
    assert "`T/Y` are spin-left/spin-right" in guide_source
