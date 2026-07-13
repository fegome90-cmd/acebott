# BLE GATT on ESP32 for iOS-Compatible Robot Control

> BLE GATT research and implementation notes for Acebott QD001.
> Compiled: 2026-07-10

## Protocol map — do not mix these stacks

This branch intentionally contains two BLE protocol stacks:

| Stack | Status | Files | UUIDs | Command format | Telemetry format |
|-------|--------|-------|-------|----------------|------------------|
| **QD001 text-v1** | **Canonical active QD001 implementation** | `sketches/ble-gatt-control/ble-gatt-control.ino`, `scripts/ble_client.py` | Service `12345678-1234-1234-1234-1234567890ab`; command `abcd1234-5678-90ab-cdef-1234567890ab`; telemetry `c8f60001-1234-5678-9abc-def012345678` | ASCII `F`, `B`, `L`, `R`, `S`, optional speed like `F,200`; `L/R` preserve the verified QD001 spin-left/spin-right mapping | UTF-8 CSV: `distance,ir_left,ir_right` |
| **Reference binary-v2** | Generic ESP32 reference only; **not canonical QD001 firmware** | `docs/references/ble-motor-control-basic.ino`, `docs/references/ble_motor_controller.py`, `docs/references/ios-ble-swift.swift` | Service `19b10000-e8f2-537e-4f6c-d104768a1214`; command `19b10002-e8f2-537e-4f6c-d104768a1214`; telemetry `19b10001-e8f2-537e-4f6c-d104768a1214` | ASCII motor commands for a generic dual-H-bridge sketch: `F/B/L/R/S`; `T/Y` are spin-left/spin-right | Packed 6 bytes: little-endian `uint16 distance`, then `uint8 ir_left`, `ir_right`, `line_center`, `battery` |

Safety contract for **QD001 text-v1**:
- Firmware failsafe stops motors after **500 ms** without a command.
- Clients must use BLE write-without-response and retransmit the active movement command below that window; `scripts/ble_client.py` uses **200 ms**.
- Clients must send `S` before exit/disconnect.
- For deliberate QD001 turns/spins, keep pulses at roughly **150 ms minimum** before sending `S`; shorter pulses may not physically register on V1.0.

Hardware validation status: this branch has software-level examples and host-side tests. Do **not** treat it as hardware-validated until `arduino-cli compile`, flash via the project flash workflow, serial boot, BLE connection, movement, failsafe, and telemetry have been observed on the robot.

---

## 1. ESP32 BLE GATT Server (Arduino-ESP32 core 2.0.18)

### 1.1 Core Libraries

| Library | Purpose |
|---------|---------|
| `BLEDevice.h` | Initialize BLE stack, get address, set TX power |
| `BLEServer.h` | Create GATT server, manage connections |
| `BLEUtils.h` | UUID helpers, utility functions |
| `BLE2902.h` | CCCD descriptor — required for notifications |
| `BLECharacteristic.h` | Define read/write/notify characteristics |

### 1.2 Stack Choice: Bluedroid vs NimBLE

| Metric | Bluedroid (default) | NimBLE (recommended) |
|--------|-------------------|---------------------|
| RAM footprint | ~110 KB | ~50 KB |
| Flash footprint | ~200 KB | ~100 KB |
| Init time | ~500 ms | ~100 ms |
| BLE 5.0 support | Partial | Full |
| Classic BT support | Yes | No |
| Throughput (1M PHY) | ~90 KB/s | ~90 KB/s |
| API compatibility | N/A | Near-identical to Bluedroid |

**Recommendation**: Use NimBLE for new projects. ~50% less RAM, faster init, BLE 5.0 features. Install via Arduino Library Manager: `NimBLE-Arduino` by h2zero.

### 1.3 PROPERTY_WRITE vs PROPERTY_WRITE_NR

This is CRITICAL for motor control:

| Property | Behavior | Latency | Use Case |
|----------|----------|---------|----------|
| `PROPERTY_WRITE` | Write With Response — client waits for ACK | +1 round-trip (~10-15ms) | Config changes, settings |
| `PROPERTY_WRITE_NR` | Write Without Response — fire and forget | Immediate | Motor commands, real-time control |

**For motor commands**: Use `PROPERTY_WRITE_NR`. The Flutter/iOS client sends commands at 50-100Hz. Waiting for ACK on each command adds unnecessary latency.

**For telemetry**: Use `PROPERTY_NOTIFY` — server pushes data to client without polling.

**Critical gotcha** (from real project): If you only use `PROPERTY_WRITE`, iOS/Flutter apps that default to write-without-response will throw: *"write no response property is not supported"*. Always include BOTH:

```cpp
BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
```

### 1.4 Notifications for Telemetry

Notifications require:
1. Characteristic created with `PROPERTY_NOTIFY`
2. `BLE2902` descriptor added to the characteristic
3. Client must subscribe (write 0x0001 to CCCD)
4. Server calls `notify()` to push data

```cpp
pCharacteristic = pService->createCharacteristic(
    CHAR_NOTIFY_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
);
pCharacteristic->addDescriptor(new BLE2902());

// Push telemetry
pCharacteristic->setValue((uint8_t*)&sensorData, sizeof(sensorData));
pCharacteristic->notify();
```

### 1.5 Reference BLE Motor Control Service

See `ble-motor-control-basic.ino` in this directory for a generic
reference/binary-v2 sketch. It is deliberately segregated from the canonical
QD001 text-v1 firmware.

Reference architecture:
- **Command characteristic** (client → ESP32): `PROPERTY_WRITE | PROPERTY_WRITE_NR`
- **Telemetry characteristic** (ESP32 → client): `PROPERTY_NOTIFY` with `BLE2902`
- **Protocol**: Single-char commands with optional speed (`F,200`); `T/Y` are generic spin-left/spin-right commands.
- **Telemetry**: Packed 6-byte binary struct
- **Safety**: Motors stop on BLE disconnect

---

## 2. iOS BLE Connection (Core Bluetooth)

### 2.1 How iOS Connects to BLE Devices

iOS uses the **Core Bluetooth** framework:

1. **CBCentralManager** scans for peripherals
2. Filters by service UUID (recommended) or name
3. Connects to **CBPeripheral**
4. Discovers services and characteristics
5. Subscribes to notifications or writes characteristics

### 2.2 Does iOS Require Specific Service UUIDs?

**No**. iOS supports:
- Standard 16-bit UUIDs (Bluetooth SIG-defined)
- Custom 128-bit UUIDs (any UUID you define)
- No Apple approval needed for custom services

Apple recommends:
- Using standard UUIDs when applicable (e.g., Battery Service 0x180F)
- Consistent UUID usage across app versions
- Advertising the service UUID for faster discovery

### 2.3 iOS Connection Parameters

| Parameter | Value | Impact |
|-----------|-------|--------|
| Min connection interval | 7.5 ms (BLE 4.2) | Theoretical minimum |
| Typical connection interval | 15-30 ms | Realistic for iOS |
| Apple devices minimum | ~15 ms (accepts 12 in some cases) | iOS-specific |
| Write Without Response | 0 ms additional | Immediate |
| Write With Response | +1 RTT (~10-15 ms) | Added latency |
| Notification delivery | 1 connection interval | Up to 30 ms |

**Key insight**: Apple devices enforce stricter BLE parameters than Android. Use this in ESP32 onConnect:

```cpp
void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) {
    pServer->setDataLen(connInfo.getConnHandle(), 251);
    pServer->updateConnParams(connInfo.getConnHandle(), 12, 24, 0, 500);
}
```

### 2.4 BLE + WiFi Simultaneously on ESP32

ESP32 uses Time-Division Multiplexing (TDM) to share radio:
- WiFi throughput drops ~50% when BLE is active
- BLE latency increases when WiFi is transferring data
- For robot control: **BLE-only is recommended** for lowest latency
- If both needed, use FreeRTOS tasks on separate cores

---

## 3. Nordic UART Service (NUS)

### 3.1 UUID Format

| Characteristic | UUID |
|---------------|------|
| Service | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` |
| TX (server → client) | `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` |
| RX (client → server) | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |

### 3.2 How NUS Emulates Serial

- **TX**: Server sends data via notifications
- **RX**: Client sends data via write commands
- Max payload: 20 bytes per packet (BLE 4.0) or 512 bytes (BLE 5.0 with DLEN)
- Compatible with iOS, Android, macOS, Windows, Linux
- Works with nRF Connect app and WebBLE

### 3.3 NUS Libraries for Arduino

| Library | Author | Notes |
|---------|--------|-------|
| `Arduino_BLESerial` | uutzinger | Full NUS implementation, HardwareSerial-compatible |
| `arduino-ble-serial` | senseshift | Customizable, NimBLE support |
| `NuS-NimBLE-Serial` | afpineda | NimBLE-specific, lightweight |

### 3.4 NUS vs Custom GATT for Motor Control

| Aspect | NUS | Custom GATT |
|--------|-----|-------------|
| Protocol overhead | Text parsing needed | Binary struct, zero overhead |
| Max throughput | ~70 KB/s | ~70 KB/s |
| Latency | Same | Same |
| Compatibility | Universal (nRF Connect, WebBLE) | App-specific |
| Complexity | Lower (serial-like API) | Higher (manual GATT setup) |
| Motor control fit | Good for prototyping | Better for production |

**Recommendation**: Start with NUS for rapid prototyping (works with nRF Connect), then move to custom GATT for production with optimized binary protocol.

---

## 4. Python BLE Clients (bleak)

### 4.1 Installation

```bash
pip install bleak
```

### 4.2 Scan and Connect to ESP32

```python
import asyncio
from bleak import BleakScanner, BleakClient

SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab"
COMMAND_CHAR_UUID = "abcd1234-5678-90ab-cdef-1234567890ab"
TELEMETRY_CHAR_UUID = "c8f60001-1234-5678-9abc-def012345678"

async def scan():
    devices = await BleakScanner.discover(timeout=5.0)
    for d in devices:
        if d.name and "QD001" in d.name:
            return d.address
    return None

async def motor_control():
    address = await scan()
    if not address:
        print("ESP32 not found")
        return

    async with BleakClient(address) as client:
        print(f"Connected: {client.is_connected}")

        # Send motor command (Write Without Response)
        await client.write_gatt_char(
            COMMAND_CHAR_UUID,
            b"F,200",  # Forward at speed 200
            response=False  # Write Without Response
        )

        # Subscribe to canonical CSV telemetry notifications
        def notification_handler(sender, data):
            distance, ir_left, ir_right = data.decode("utf-8").split(",")
            print(f"Distance: {distance}cm, IR: {ir_left},{ir_right}")

        await client.start_notify(TELEMETRY_CHAR_UUID, notification_handler)
        await asyncio.sleep(5)  # Run for 5 seconds

asyncio.run(motor_control())
```

### 4.3 Write Without Response vs With Response

| Method | bleak API | Latency | Use Case |
|--------|-----------|---------|----------|
| Write Without Response | `write_gatt_char(uuid, data, response=False)` | Immediate | Motor commands |
| Write With Response | `write_gatt_char(uuid, data, response=True)` | +1 RTT | Config changes |

### 4.4 Complete Python BLE Motor Controller

Use `../../scripts/ble_client.py` for the canonical QD001 text-v1 client. It
provides async input, write-without-response, command retransmit every 200 ms,
and sends `S` on exit.

`ble_motor_controller.py` in this directory is the generic reference/binary-v2
client. It parses exactly the packed 6-byte telemetry emitted by
`ble-motor-control-basic.ino`.

---

## 5. BLE GATT vs Classic SPP vs WiFi Comparison

### 5.1 Latency

| Protocol | Typical Latency | Min Latency | Source |
|----------|----------------|-------------|--------|
| BLE GATT (7.5ms interval) | 7-8 ms | 4.3 ms | ble-gamepad-latency benchmark |
| BLE GATT (15ms interval) | 15-16 ms | 12 ms | ESP-IDF default |
| BLE GATT (30ms interval) | 30-32 ms | 28 ms | iOS default |
| Classic SPP | 2-5 ms | <1 ms | Electric UI benchmark |
| WiFi (TCP) | 1-5 ms | <1 ms | Local network |
| WiFi (HTTP) | 50-200 ms | 20 ms | HTTP overhead |

**Winner for motor control**: WiFi (lowest latency), then SPP, then BLE.

### 5.2 Throughput

| Protocol | Max Throughput | Practical Throughput |
|----------|---------------|---------------------|
| BLE GATT (1M PHY) | 90 KB/s | 30-60 KB/s |
| BLE GATT (2M PHY) | 170 KB/s | 60-100 KB/s |
| BLE L2CAP COC | 60 KB/s | 40-50 KB/s |
| Classic SPP | 100-300 KB/s | 50-100 KB/s |
| WiFi (TCP) | 20-30 MB/s | 1-5 MB/s |

**Winner**: WiFi by 100x for throughput.

### 5.3 Memory (RAM)

| Stack | RAM Usage |
|-------|-----------|
| NimBLE | ~50 KB |
| Bluedroid (BLE only) | ~110 KB |
| Bluedroid (BLE + Classic) | ~150 KB |
| WiFi (TCP/IP + LWIP) | ~50-80 KB |
| WiFi + BLE (both) | ~160-200 KB |

**Winner**: NimBLE uses least RAM.

### 5.4 iOS Support

| Protocol | iOS Support | Notes |
|----------|-------------|-------|
| BLE GATT | Full | Native Core Bluetooth |
| Classic SPP | No | Not supported on iOS |
| WiFi (HTTP) | Full | Via URLSession |
| WiFi (WebSocket) | Full | Via URLSession |

**Winner**: BLE GATT is the only wireless serial option on iOS.

### 5.5 macOS Support

| Protocol | macOS Support | Notes |
|----------|---------------|-------|
| BLE GATT | Full | Core Bluetooth |
| Classic SPP | Limited | Some adapters, not reliable |
| WiFi (TCP) | Full | Native |

### 5.6 Summary Matrix

| Criterion | BLE GATT | Classic SPP | WiFi |
|-----------|----------|-------------|------|
| iOS support | Yes | **No** | Yes |
| Latency | 7-30 ms | 2-5 ms | 1-5 ms |
| Throughput | 30-170 KB/s | 100-300 KB/s | 1-5 MB/s |
| Power | Low | Medium | High |
| Range | 10-30m | 10-30m | 50-100m |
| Setup complexity | Medium | Low | Low |
| Multi-client | 7-8 devices | 1 device | Many |

**Verdict for Acebott QD001**: BLE GATT is the ONLY viable option for iOS control. WiFi is better for latency/throughput but SPP doesn't work on iPhone.

---

## 6. Real Projects Using BLE GATT for Motor Control

### 6.1 ESP32 BLE Robot Car (Flutter)

**Source**: hamzaimran.com - Build a BLE Controlled Car with ESP32 & Flutter

Key findings:
- Uses `PROPERTY_WRITE | PROPERTY_WRITE_NR` — critical for Flutter compatibility
- Simple single-character protocol: `F`, `B`, `L`, `R`, `S` + optional speed
- Flutter's `flutter_blue_plus` package handles iOS and Android
- Commands sent as UTF-8 strings at 50Hz
- Latency: ~15-20ms with 15ms connection interval

### 6.2 ESP32 BLE Mecanum Robot (Python GUI)

**Source**: github.com/KingLuLu-cal/jarVIs

Key findings:
- Uses custom GATT service with 4 characteristics (sensors + commands)
- Binary protocol for motor commands (text for setup)
- Python client uses `bleak` library
- Supports both manual control and autonomous mode
- BLE command format: `FORWARD`, `BACKWARD`, `V180` (velocity)

### 6.3 ESP32 Boat Motor Control

**Source**: github.com/omnia-makers/esp32_boat

Key findings:
- Controls L298N H-Bridge motor driver via BLE
- Commands: `on`, `off`, `x <angle>` (servo), `y <power>` (motor)
- Web-based client interface
- Combines servo and motor control in single characteristic

### 6.4 Osoyoo BLE Robot Car

**Source**: github.com/osoyoo/espro_ble_car

Key findings:
- Uses Bluedroid stack (default Arduino BLE library)
- Protocol: `M` (forward), `B` (backward), `L`, `R`, `E` (stop) + speed
- Includes `BLE2902` descriptor for notifications
- Auto-stops on disconnect for safety
- iOS connection parameters set via `setMinPreferred(0x06)` and `setMinPreferred(0x12)`

### 6.5 OpenIndus Advanced Motor Kit (NimBLE)

**Source**: openindus.com

Key findings:
- Uses NimBLE library for 50% less RAM
- GATT service UUID `A100` with multiple characteristics
- Raw binary protocol: 4-byte IEEE 754 floats for motor speed
- `MotorStatus_t` struct sent via notifications
- Connection parameter optimization: `updateConnParams(handle, 12, 24, 0, 500)`
- 50ms notification loop (20Hz telemetry)

---

## 7. Recommended Architecture for Acebott QD001

### 7.1 Canonical QD001 text-v1 BLE Service Design

```
Service: QD001 Control (custom 128-bit UUID)
├── Command Characteristic (WRITE_NR)
│   ├── Format: "F,200" or single char "S"
│   ├── Directions: F(ward), B(ack), L(spin left), R(spin right), S(top)
│   └── Speed: 100-255, default 150
│
├── Telemetry Characteristic (NOTIFY)
│   ├── CSV text: "distance,ir_left,ir_right"
│   └── Rate: 10Hz (100ms interval)
```

Keep callbacks short: copy/enqueue command bytes only. The firmware `loop()`
owns connection flags, motor calls, 500 ms failsafe, and telemetry publication.

### 7.2 BLE Protocol vs WiFi Protocol

| Aspect | WiFi (current) | BLE GATT (proposed) |
|--------|---------------|---------------------|
| API | HTTP GET `/Car?move=f` | Write to characteristic |
| Latency | 50-200ms (HTTP) | 15-30ms (BLE) |
| iOS support | Yes (Safari) | Yes (Core Bluetooth) |
| Power | ~180mA | ~45mA |
| Range | 50m | 10-30m |
| Multi-client | Unlimited | 7-8 devices |
| Setup | Connect to AP | Scan + Pair |

### 7.3 Reference binary-v2 stack boundary

The binary examples are useful for learning packed telemetry and Swift/Core
Bluetooth parsing, but they are not QD001-compatible as-is. They use a generic
dual-H-bridge pin map, a separate UUID set, and binary telemetry. Do not document
or test them as if they matched `sketches/ble-gatt-control/ble-gatt-control.ino`.

---

## 8. Code Examples Directory

| File | Description |
|------|-------------|
| `../../sketches/ble-gatt-control/ble-gatt-control.ino` | Canonical QD001 text-v1 BLE firmware |
| `../../scripts/ble_client.py` | Canonical QD001 text-v1 Python client |
| `ble-motor-control-basic.ino` | Generic reference/binary-v2 ESP32 BLE motor control sketch |
| `ble-motor-control-nimble.ino` | External/future example idea; not present in this repository |
| `ble-nus-serial.ino` | External/future NUS example idea; not present in this repository |
| `ble_motor_controller.py` | Reference/binary-v2 Python bleak client |
| `ios-ble-swift.swift` | Reference/binary-v2 iOS Core Bluetooth manager (Swift) |

---

## 9. References

- Electric UI Latency Benchmark: https://electricui.com/blog/latency-comparison
- BLE Gamepad Latency Benchmark: https://github.com/1dle/ble-gamepad-latency
- NimBLE-Arduino Library: https://github.com/h2zero/NimBLE-Arduino
- ESP-IDF BLE Performance: https://docs.espressif.com/projects/esp-idf/en/v5.0.4/esp32/api-guides/performance/
- Nordic UART Service: https://docs.nordicsemi.com/bundle/ncs-latest/page/nrf/libraries/bluetooth/services/nus.html
- Apple Core Bluetooth Guide: https://developer.apple.com/documentation/corebluetooth
- ESP32 BLE vs Classic: https://zbotic.in/esp32-bluetooth-classic-vs-ble-when-to-use-which-protocol/
- BLE + WiFi Coexistence: https://circuitlabs.net/bluetooth-and-wifi-coexistence-strategies/
