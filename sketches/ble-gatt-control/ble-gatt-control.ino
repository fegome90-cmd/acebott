/*
 * BLE GATT Motor Control for Acebott QD001
 * 
 * Creates a BLE GATT server with:
 * - Command characteristic (WRITE) for motor commands
 * - Telemetry characteristic (READ/NOTIFY) for sensor data
 * 
 * Compatible with iOS (Core Bluetooth), macOS (Core Bluetooth), Android, Python (bleak)
 * 
 * Protocol: Single ASCII char commands + optional speed
 *   'F' = Forward, 'B' = Backward, 'L' = Spin Left, 'R' = Spin Right, 'S' = Stop
 *   'F,200' = Forward at speed 200
 * 
 * Hardware: Acebott QD001 ESP32 MAX V1.0
 * Library: ACB_SmartCar_V2 (built-in), BLEDevice (built-in)
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ACB_SmartCar_V2.h>

// BLE Service and Characteristics
#define SERVICE_UUID        "12345678-1234-1234-1234-1234567890ab"
#define COMMAND_UUID        "abcd1234-5678-90ab-cdef-1234567890ab"
#define TELEMETRY_UUID      "c8f60001-1234-5678-9abc-def012345678"

// Motor control
ACB_SmartCar_V2 ACB_SmartCar;
int currentSpeed = 150;  // Default speed
unsigned long lastCommandTime = 0;
const unsigned long FAILSAFE_TIMEOUT = 500;  // Stop after 500ms without commands

// BLE objects
BLECharacteristic* commandChar;
BLECharacteristic* telemetryChar;
bool deviceConnected = false;

// SPP-style disconnect callback
void btCallback(esp_spp_cb_event_t event, esp_spp_cb_param_t *param) {
  if (event == ESP_SPP_CLOSE_EVT) {
    ACB_SmartCar.Move(Stop, 0);
    Serial.println("[BLE] Client disconnected, motors stopped");
  }
}

// BLE Server callbacks
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("[BLE] Client connected");
  }
  
  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    ACB_SmartCar.Move(Stop, 0);  // Safety: stop on disconnect
    Serial.println("[BLE] Client disconnected, motors stopped");
    
    // Restart advertising for reconnection
    BLEDevice::startAdvertising();
  }
};

// Command characteristic callbacks
class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    String value = pCharacteristic->getValue().c_str();
    if (value.length() == 0) return;
    
    lastCommandTime = millis();  // Reset failsafe timer
    
    // Parse command: "F" or "F,200"
    char cmd = value[0];
    int speed = currentSpeed;  // Default to current speed
    
    // Check for speed parameter (after comma)
    int commaIndex = value.indexOf(',');
    if (commaIndex > 0 && commaIndex < value.length() - 1) {
      int newSpeed = value.substring(commaIndex + 1).toInt();
      if (newSpeed >= 100 && newSpeed <= 255) {
        currentSpeed = newSpeed;
        speed = currentSpeed;
      }
    }
    
    // Execute command
    switch (cmd) {
      case 'F': ACB_SmartCar.Move(Forward, speed); break;
      case 'B': ACB_SmartCar.Move(Backward, speed); break;
      case 'L': ACB_SmartCar.Move(Contrarotate, speed); break;
      case 'R': ACB_SmartCar.Move(Clockwise, speed); break;
      case 'S': ACB_SmartCar.Move(Stop, 0); break;
      default:
        Serial.print("[BLE] Unknown command: ");
        Serial.println(cmd);
        break;
    }
    
    // Echo command to serial for debugging
    Serial.print("[BLE] Command: ");
    Serial.print(cmd);
    Serial.print(", Speed: ");
    Serial.println(speed);
  }
};

void setup() {
  Serial.begin(115200);
  ACB_SmartCar.Init();
  
  // Initialize BLE
  BLEDevice::init("QD001-BLE");
  
  // Create BLE server
  BLEServer* pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  
  // Create BLE service
  BLEService* pService = pServer->createService(SERVICE_UUID);
  
  // Create command characteristic (WRITE)
  commandChar = pService->createCharacteristic(
    COMMAND_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  commandChar->setCallbacks(new CommandCallbacks());
  
  // Create telemetry characteristic (READ/NOTIFY)
  telemetryChar = pService->createCharacteristic(
    TELEMETRY_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  telemetryChar->addDescriptor(new BLE2902());
  
  // Start service
  pService->start();
  
  // Start advertising
  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  
  Serial.println("[BLE] Ready — waiting for connection");
  Serial.print("[BLE] Device name: QD001-BLE");
  Serial.print("[BLE] Service UUID: ");
  Serial.println(SERVICE_UUID);
}

void loop() {
  // Failsafe: stop motors if no command received within timeout
  if (lastCommandTime > 0 && (millis() - lastCommandTime > FAILSAFE_TIMEOUT)) {
    ACB_SmartCar.Move(Stop, 0);
    lastCommandTime = 0;  // Reset to avoid repeated stops
    Serial.println("[BLE] Failsafe: no command received, motors stopped");
  }
  
  // Send telemetry every 100ms if connected
  if (deviceConnected) {
    // TODO: Read actual sensor data
    int distance = 0;  // Replace with Ultrasonic.Ranging()
    int ir_left = 0;   // Replace with analogRead(Left_Line)
    int ir_right = 0;  // Replace with analogRead(Right_Line)
    
    String telemetry = String(distance) + "," + String(ir_left) + "," + String(ir_right);
    telemetryChar->setValue(telemetry.c_str());
    telemetryChar->notify();
  }
  
  delay(100);  // 10Hz telemetry rate
}
