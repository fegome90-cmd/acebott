/*
 * BLE GATT Motor Control for Acebott QD001 ESP32 MAX V1.0
 * 
 * Minimal working example using Bluedroid (default Arduino BLE library).
 * 
 * Protocol:
 *   Client → ESP32: Single char commands on Command Characteristic
 *     F,B,L,R,S = Forward, Backward, Left, Right, Stop
 *     F,200 = Forward at speed 200 (0-255)
 *   ESP32 → Client: Binary telemetry on Telemetry Characteristic (NOTIFY)
 * 
 * Hardware: Acebott QD001 with L298N motor driver
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

// === Motor Pins (Acebott QD001 L298N) ===
#define ENA 12
#define IN1 27
#define IN2 26
#define ENB 13
#define IN3 25
#define IN4 33

// === Sensor Pins ===
#define TRIG_PIN 13
#define ECHO_PIN 14
#define IR_LEFT_PIN 35
#define IR_RIGHT_PIN 34
#define LINE_CENTER_PIN 32

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
  digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH);  // Fixed: both backward for spin
  analogWrite(ENA, speed); analogWrite(ENB, speed);
}

void spinRight(int speed) {
  digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);  // Fixed: both forward for spin
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
    std::string value = pCharacteristic->getValue();
    if (value.length() < 1) return;

    char cmd = value[0];
    int speed = 150; // default speed

    // Parse optional speed: "F,200" or just "F"
    if (value.length() > 2 && value[1] == ',') {
      speed = atoi(value.substr(2).c_str());
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
  Serial.println("BLE Motor Control - Acebott QD001");

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
