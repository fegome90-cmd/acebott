/*
 * iOS BLE Manager for Acebott QD001 Robot Control
 * Swift + Core Bluetooth
 *
 * Usage:
 *   1. Add to Xcode project
 *   2. Add "NSBluetoothAlwaysUsageDescription" to Info.plist
 *   3. Call BLEManager.shared.startScanning()
 *   4. Call BLEManager.shared.sendCommand("F,200")
 */

import Foundation
import CoreBluetooth

// MARK: - UUIDs (must match ESP32 firmware)

enum QD001UUIDs {
    static let serviceUUID = CBUUID(string: "19b10000-e8f2-537e-4f6c-d104768a1214")
    static let commandCharUUID = CBUUID(string: "19b10002-e8f2-537e-4f6c-d104768a1214")
    static let telemetryCharUUID = CBUUID(string: "19b10001-e8f2-537e-4f6c-d104768a1214")
}

// MARK: - Telemetry Struct

struct RobotTelemetry {
    let distance: UInt16
    let irLeft: UInt8
    let irRight: UInt8
    let lineCenter: UInt8
    let battery: UInt8

    init?(data: Data) {
        guard data.count >= 6 else { return nil }
        self.distance = data.withUnsafeBytes { $0.load(fromByteOffset: 0, as: UInt16.self) }
        self.irLeft = data[2]
        self.irRight = data[3]
        self.lineCenter = data[4]
        self.battery = data[5]
    }
}

// MARK: - BLE Manager

class BLEManager: NSObject, ObservableObject, CBCentralManagerDelegate, CBPeripheralDelegate {

    static let shared = BLEManager()

    // Published properties for SwiftUI binding
    @Published var isConnected = false
    @Published var isScanning = false
    @Published var lastTelemetry: RobotTelemetry?
    @Published var connectionError: String?

    // Core Bluetooth
    private var centralManager: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var commandCharacteristic: CBCharacteristic?
    private var telemetryCharacteristic: CBCharacteristic?

    // Callbacks
    var onTelemetryUpdate: ((RobotTelemetry) -> Void)?
    var onConnectionChange: ((Bool) -> Void)?

    override init() {
        super.init()
        centralManager = CBCentralManager(delegate: self, queue: nil)
    }

    // MARK: - Public API

    func startScanning() {
        guard centralManager.state == .poweredOn else {
            connectionError = "Bluetooth not available"
            return
        }
        isScanning = true
        connectionError = nil
        centralManager.scanForPeripherals(
            withServices: [QD001UUIDs.serviceUUID],
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
        )
        // Stop scanning after 10 seconds
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            self?.stopScanning()
        }
    }

    func stopScanning() {
        centralManager.stopScan()
        isScanning = false
    }

    func disconnect() {
        if let peripheral = peripheral {
            centralManager.cancelPeripheralConnection(peripheral)
        }
    }

    func sendCommand(_ command: String) {
        guard let characteristic = commandCharacteristic,
              let peripheral = peripheral,
              let data = command.data(using: .utf8) else {
            print("Cannot send: not connected or characteristic not found")
            return
        }

        // Write Without Response for low-latency motor control
        peripheral.writeValue(data, for: characteristic, type: .withoutResponse)
    }

    // MARK: - Convenience Commands

    func moveForward(speed: Int = 150) { sendCommand("F,\(speed)") }
    func moveBackward(speed: Int = 150) { sendCommand("B,\(speed)") }
    func turnLeft(speed: Int = 150) { sendCommand("L,\(speed)") }
    func turnRight(speed: Int = 150) { sendCommand("R,\(speed)") }
    func stop() { sendCommand("S") }

    // MARK: - CBCentralManagerDelegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            print("Bluetooth is ON")
        case .poweredOff:
            connectionError = "Bluetooth is OFF"
            isConnected = false
        case .unauthorized:
            connectionError = "Bluetooth unauthorized"
        case .unsupported:
            connectionError = "BLE not supported on this device"
        default:
            connectionError = "Bluetooth state: \(central.state.rawValue)"
        }
    }

    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        // Reject weak signals
        guard RSSI.intValue >= -70 else {
            print("Rejecting weak signal: \(RSSI.intValue) dBm")
            return
        }

        print("Found: \(peripheral.name ?? "Unknown") at \(RSSI.intValue) dBm")

        self.peripheral = peripheral
        stopScanning()
        centralManager.connect(peripheral, options: nil)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        print("Connected to \(peripheral.name ?? "Unknown")")
        self.peripheral = peripheral
        peripheral.delegate = self
        peripheral.discoverServices([QD001UUIDs.serviceUUID])
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        print("Disconnected: \(peripheral.name ?? "Unknown")")
        DispatchQueue.main.async {
            self.isConnected = false
            self.peripheral = nil
            self.commandCharacteristic = nil
            self.telemetryCharacteristic = nil
        }
        onConnectionChange?(false)
        // Auto-reconnect
        startScanning()
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        connectionError = "Failed to connect: \(error?.localizedDescription ?? "unknown")"
    }

    // MARK: - CBPeripheralDelegate

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error = error {
            connectionError = "Service discovery failed: \(error.localizedDescription)"
            return
        }

        guard let services = peripheral.services else { return }

        for service in services where service.uuid == QD001UUIDs.serviceUUID {
            peripheral.discoverCharacteristics(
                [QD001UUIDs.commandCharUUID, QD001UUIDs.telemetryCharUUID],
                for: service
            )
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        if let error = error {
            connectionError = "Characteristic discovery failed: \(error.localizedDescription)"
            return
        }

        guard let characteristics = service.characteristics else { return }

        for char in characteristics {
            switch char.uuid {
            case QD001UUIDs.commandCharUUID:
                commandCharacteristic = char
                print("Command characteristic found")
            case QD001UUIDs.telemetryCharUUID:
                telemetryCharacteristic = char
                // Subscribe to notifications
                peripheral.setNotifyValue(true, for: char)
                print("Telemetry characteristic found, notifications enabled")
            default:
                break
            }
        }

        if commandCharacteristic != nil && telemetryCharacteristic != nil {
            DispatchQueue.main.async {
                self.isConnected = true
            }
            onConnectionChange?(true)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard characteristic.uuid == QD001UUIDs.telemetryCharUUID,
              let data = characteristic.value,
              let telemetry = RobotTelemetry(data: data) else {
            return
        }

        DispatchQueue.main.async {
            self.lastTelemetry = telemetry
        }
        onTelemetryUpdate?(telemetry)
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        if let error = error {
            print("Write error: \(error.localizedDescription)")
        }
    }
}

// MARK: - SwiftUI Usage Example

/*
 import SwiftUI

 struct RobotControlView: View {
     @StateObject private var ble = BLEManager.shared

     var body: some View {
         VStack(spacing: 20) {
             Text(ble.isConnected ? "Connected" : "Disconnected")
                 .foregroundColor(ble.isConnected ? .green : .red)

             if let telemetry = ble.lastTelemetry {
                 Text("Distance: \(telemetry.distance) cm")
                 Text("IR: L=\(telemetry.irLeft) R=\(telemetry.irRight)")
             }

             HStack {
                 Button("Left") { ble.turnLeft() }
                 Button("Forward") { ble.moveForward() }
                 Button("Right") { ble.turnRight() }
             }

             Button("Stop") { ble.stop() }
                 .foregroundColor(.red)

             HStack {
                 Button("Back") { ble.moveBackward() }
             }
         }
         .onAppear { ble.startScanning() }
     }
 }
 */
