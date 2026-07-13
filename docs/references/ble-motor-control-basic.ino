/*
 * Reference/binary-v2 BLE GATT Motor Control for a generic ESP32 robot
 *
 * Minimal Bluedroid example. This is NOT the canonical QD001 firmware.
 * The active QD001 stack is sketches/ble-gatt-control/ble-gatt-control.ino:
 *   - UUIDs: 12345678... / abcd1234... / c8f60001...
 *   - Commands: text-v1 F/B/L/R/S
 *   - Telemetry: CSV text
 *
 * Reference/binary-v2 protocol:
 *   Client → ESP32: Single char commands on Command Characteristic
 *     F,B,L,R,S = Forward, Backward, Left, Right, Stop
 *     F,200 = Forward at speed 200 (0-255)
 *   ESP32 → Client: packed 6-byte binary telemetry on Telemetry Characteristic
 *
 * Hardware: generic ESP32 + external dual H-bridge. Pin choices below avoid the
 * documented QD001 GPIOs so this reference cannot be confused with QD001 wiring.
 * Stack: Bluedroid (default in Arduino ESP32 core 2.0.18)
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// === BLE UUIDs (random 128-bit) ===
#define SERVICE_UUID          "19b10000-e8f2-537e-4f6c-d104768a1214"
#define CHAR_COMMAND_UUID     "19b10002-e8f2-537e-4f6c-d104768a1214"
#define CHAR_TELEMETRY_UUID   "19b10001-e8f2-537e-4f6c-d104768a1214"

// === Generic dual H-bridge motor pins ===
#define ENA 16
#define IN1 17
#define IN2 18
#define ENB 19
#define IN3 21
#define IN4 22

// === Generic sensor pins ===
#define TRIG_PIN 23
#define ECHO_PIN 34
#define IR_LEFT_PIN 27
#define IR_RIGHT_PIN 32
#define LINE_CENTER_PIN 5

// === BLE Globals ===
BLEServer* pServer = nullptr;
BLECharacteristic* pCommandChar = nullptr;
BLECharacteristic* pTelemetryChar = nullptr;
bool deviceConnected = false;

// === Telemetry Struct (packed binary) ===
struct __attribute__((packed)) Telemetry {
  uint16_t distance;  // ultrasonic distance in cm
  uint8_t irLeft;     // 0 or 1
  uint8_t irRight;    // 0 or 1
  uint8_t lineCenter; // analog value 0-255
  uint8_t battery;    // placeholder
};

// === Motor Control Functions ===
void moveForward(int speed) {
  digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
  analogWrite(ENA, speed); analogWrite(ENB, speed);
}

void moveBackward(int speed) {
  digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH);
  analogWrite(ENA, speed); analogWrite(ENB, speed);
}

void turnLeft(int speed) {
  digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH);
  digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
  analogWrite(ENA, speed); analogWrite(ENB, speed);
}

void turnRight(int speed) {
  digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH);
  analogWrite(ENA, speed); analogWrite(ENB, speed);
}

void spinLeft(int speed) {
  // Differential-drive spin: left motor backward, right motor forward.
  digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH);
  digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
  analogWrite(ENA, speed); analogWrite(ENB, speed);
}

void spinRight(int speed) {
  // Differential-drive spin: left motor forward, right motor backward.
  digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH);
  analogWrite(ENA, speed); analogWrite(ENB, speed);
}

void stopMotors() {
  digitalWrite(IN1, LOW); digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW); digitalWrite(IN4, LOW);
  analogWrite(ENA, 0); analogWrite(ENB, 0);
}

// === Sensor Functions ===
long readUltrasonic() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000); // 30ms timeout
  if (duration == 0) return 999; // timeout = no obstacle
  return duration * 0.034 / 2;
}

// === BLE Callbacks ===
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("BLE Client Connected");
  }
  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("BLE Client Disconnected");
    stopMotors(); // Safety: stop on disconnect
    BLEDevice::startAdvertising(); // Restart advertising
  }
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    String value = pCharacteristic->getValue();
    if (value.length() < 1) return;

    char cmd = value[0];
    int speed = 150; // default speed

    // Parse optional speed: "F,200" or just "F"
    if (value.length() > 2 && value[1] == ',') {
      speed = value.substring(2).toInt();
      speed = constrain(speed, 0, 255);
    }

    Serial.printf("CMD: %c, Speed: %d\n", cmd, speed);

    switch (cmd) {
      case 'F': moveForward(speed); break;
      case 'B': moveBackward(speed); break;
      case 'L': turnLeft(speed); break;
      case 'R': turnRight(speed); break;
      case 'T': spinLeft(speed); break;   // T = turn/spin left
      case 'Y': spinRight(speed); break;  // Y = turn/spin right
      case 'S': stopMotors(); break;
      default:
        Serial.printf("Unknown command: %c\n", cmd);
    }
  }
};

// === Setup ===
void setup() {
  Serial.begin(115200);
  Serial.println("BLE Motor Control - generic reference/binary-v2");

  // Motor pins
  pinMode(ENA, OUTPUT); pinMode(ENB, OUTPUT);
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  stopMotors();

  // Sensor pins
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(IR_LEFT_PIN, INPUT);
  pinMode(IR_RIGHT_PIN, INPUT);
  pinMode(LINE_CENTER_PIN, INPUT);

  // BLE Initialization
  BLEDevice::init("QD001_Robot");
  BLEDevice::setPower(ESP_PWR_LVL_P9); // Max TX power for range

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  // Command characteristic: WRITE + WRITE_NR (critical for iOS/Flutter)
  pCommandChar = pService->createCharacteristic(
    CHAR_COMMAND_UUID,
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_WRITE_NR
  );
  pCommandChar->setCallbacks(new CommandCallbacks());

  // Telemetry characteristic: NOTIFY with BLE2902 descriptor
  pTelemetryChar = pService->createCharacteristic(
    CHAR_TELEMETRY_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pTelemetryChar->addDescriptor(new BLE2902());

  pService->start();

  // Advertising
  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  // iOS connection parameters
  pAdvertising->setMinPreferred(0x06); // 10ms
  pAdvertising->setMinPreferred(0x12); // 20ms
  BLEDevice::startAdvertising();

  Serial.println("BLE GATT Server ready!");
  Serial.print("Device name: ");
  Serial.println(BLEDevice::getAddress().toString().c_str());
}

// === Loop ===
void loop() {
  if (deviceConnected) {
    static unsigned long lastTelemetry = 0;
    if (millis() - lastTelemetry > 100) { // 10Hz telemetry
      lastTelemetry = millis();

      Telemetry t;
      t.distance = readUltrasonic();
      t.irLeft = digitalRead(IR_LEFT_PIN);
      t.irRight = digitalRead(IR_RIGHT_PIN);
      t.lineCenter = analogRead(LINE_CENTER_PIN) >> 4; // 12-bit to 8-bit
      t.battery = 0; // TODO: implement battery ADC

      pTelemetryChar->setValue((uint8_t*)&t, sizeof(t));
      pTelemetryChar->notify();
    }
  }
  delay(10);
}
