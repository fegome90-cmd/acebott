/*
 * Canonical text-v1 BLE GATT Motor Control for Acebott QD001.
 *
 * Protocol:
 *   Command characteristic (WRITE/WRITE_NR):
 *     "F,200" = Forward
 *     "B,200" = Backward
 *     "L,200" = Spin Left  (ACB_SmartCar.Move(Contrarotate, speed))
 *     "R,200" = Spin Right (ACB_SmartCar.Move(Clockwise, speed))
 *     "S"     = Stop
 *   Telemetry characteristic (READ/NOTIFY):
 *     UTF-8 CSV: "distance,ir_left,ir_right"
 *
 * Safety:
 *   - Client should retransmit active movement commands every <=200 ms.
 *   - Firmware stops after 500 ms without a command.
 *   - Invalid or unknown commands stop the motors and do not refresh the failsafe.
 *   - Disconnect wins over queued writes: loop() drops pending commands before
 *     stopping and never applies stale movement while disconnected.
 *   - BLE callbacks only copy/enqueue data; loop() owns motor calls, failsafe,
 *     telemetry, and connection state transitions.
 *
 * QD001 gotcha: short turn/spin pulses may not register physically. Use at
 * least ~150 ms pulses for deliberate turns, then send "S".
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ACB_SmartCar_V2.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>

#define SERVICE_UUID        "12345678-1234-1234-1234-1234567890ab"
#define COMMAND_UUID        "abcd1234-5678-90ab-cdef-1234567890ab"
#define TELEMETRY_UUID      "c8f60001-1234-5678-9abc-def012345678"

const unsigned long FAILSAFE_TIMEOUT_MS = 500;
const unsigned long TELEMETRY_INTERVAL_MS = 100;
const int DEFAULT_SPEED = 150;
const int MIN_SPEED = 100;
const int MAX_SPEED = 255;
const size_t COMMAND_BUFFER_SIZE = 16;

ACB_SmartCar_V2 ACB_SmartCar;
BLECharacteristic* telemetryChar = nullptr;

portMUX_TYPE bleMux = portMUX_INITIALIZER_UNLOCKED;
char pendingCommand[COMMAND_BUFFER_SIZE] = {0};
volatile bool commandPending = false;
volatile bool connectPending = false;
volatile bool disconnectPending = false;

bool deviceConnected = false;
int currentSpeed = DEFAULT_SPEED;
unsigned long lastCommandTime = 0;
unsigned long lastTelemetryTime = 0;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    portENTER_CRITICAL(&bleMux);
    connectPending = true;
    portEXIT_CRITICAL(&bleMux);
  }

  void onDisconnect(BLEServer* pServer) override {
    portENTER_CRITICAL(&bleMux);
    disconnectPending = true;
    portEXIT_CRITICAL(&bleMux);
  }
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    String value = pCharacteristic->getValue();
    if (value.length() == 0) {
      return;
    }

    char local[COMMAND_BUFFER_SIZE] = {0};
    size_t copyLength = value.length();
    if (copyLength >= COMMAND_BUFFER_SIZE) {
      copyLength = COMMAND_BUFFER_SIZE - 1;
    }
    memcpy(local, value.c_str(), copyLength);

    portENTER_CRITICAL(&bleMux);
    memcpy(pendingCommand, local, COMMAND_BUFFER_SIZE);
    commandPending = true;
    portEXIT_CRITICAL(&bleMux);
  }
};

void applyMotorCommand(char cmd, int speed) {
  switch (cmd) {
    case 'F':
      ACB_SmartCar.Move(Forward, speed);
      break;
    case 'B':
      ACB_SmartCar.Move(Backward, speed);
      break;
    case 'L':
      ACB_SmartCar.Move(Contrarotate, speed);
      break;
    case 'R':
      ACB_SmartCar.Move(Clockwise, speed);
      break;
    case 'S':
      ACB_SmartCar.Move(Stop, 0);
      break;
  }
}

bool parseCommand(const char* rawCommand, char* cmd, int* speed) {
  if (rawCommand == nullptr || rawCommand[0] == '\0') {
    return false;
  }

  *cmd = toupper((unsigned char)rawCommand[0]);
  *speed = currentSpeed;

  if (*cmd == 'S') {
    *speed = 0;
    return rawCommand[1] == '\0';
  }

  if (*cmd != 'F' && *cmd != 'B' && *cmd != 'L' && *cmd != 'R') {
    return false;
  }

  if (rawCommand[1] != ',' || rawCommand[2] == '\0') {
    return false;
  }

  for (const char* cursor = rawCommand + 2; *cursor != '\0'; cursor++) {
    if (!isdigit((unsigned char)*cursor)) {
      return false;
    }
  }

  char* end = nullptr;
  long requestedSpeed = strtol(rawCommand + 2, &end, 10);
  if (*end != '\0') {
    return false;
  }
  if (requestedSpeed < MIN_SPEED || requestedSpeed > MAX_SPEED) {
    return false;
  }

  currentSpeed = requestedSpeed;
  *speed = currentSpeed;
  return true;
}

void rejectCommand(const char* rawCommand) {
  // Safe behavior: invalid input stops the robot and clears the failsafe timer
  // instead of extending movement with malformed or unknown commands.
  ACB_SmartCar.Move(Stop, 0);
  lastCommandTime = 0;
  Serial.print("[BLE] Invalid command stopped motors: ");
  Serial.println(rawCommand);
}

void processCommand(const char* rawCommand) {
  char cmd = 'S';
  int speed = currentSpeed;
  if (!parseCommand(rawCommand, &cmd, &speed)) {
    rejectCommand(rawCommand);
    return;
  }

  lastCommandTime = millis();
  applyMotorCommand(cmd, speed);

  Serial.print("[BLE] Command: ");
  Serial.print(cmd);
  Serial.print(", Speed: ");
  Serial.println(speed);
}

void processBleEvents() {
  bool localConnect = false;
  bool localDisconnect = false;
  bool localCommandPending = false;
  char localCommand[COMMAND_BUFFER_SIZE] = {0};

  portENTER_CRITICAL(&bleMux);
  if (connectPending) {
    localConnect = true;
    connectPending = false;
    memset(pendingCommand, 0, COMMAND_BUFFER_SIZE);
    commandPending = false;
  }
  if (disconnectPending) {
    localDisconnect = true;
    disconnectPending = false;
    memset(pendingCommand, 0, COMMAND_BUFFER_SIZE);
    commandPending = false;
  }
  if (!localDisconnect && commandPending) {
    memcpy(localCommand, pendingCommand, COMMAND_BUFFER_SIZE);
    memset(pendingCommand, 0, COMMAND_BUFFER_SIZE);
    commandPending = false;
    localCommandPending = true;
  }
  portEXIT_CRITICAL(&bleMux);

  if (localConnect) {
    deviceConnected = true;
    lastCommandTime = 0;
    Serial.println("[BLE] Client connected");
  }

  if (localDisconnect) {
    // Disconnect wins deterministically: drop any command copied this loop,
    // stop motors, clear failsafe state, and return before command processing.
    localCommandPending = false;
    localCommand[0] = '\0';
    deviceConnected = false;
    ACB_SmartCar.Move(Stop, 0);
    lastCommandTime = 0;
    Serial.println("[BLE] Client disconnected, pending commands dropped, motors stopped");
    BLEDevice::startAdvertising();
    return;
  }

  if (localCommandPending) {
    if (deviceConnected) {
      processCommand(localCommand);
    } else {
      Serial.println("[BLE] Dropped command while disconnected");
    }
  }
}

void processFailsafe() {
  if (lastCommandTime > 0 && millis() - lastCommandTime > FAILSAFE_TIMEOUT_MS) {
    ACB_SmartCar.Move(Stop, 0);
    lastCommandTime = 0;
    Serial.println("[BLE] Failsafe: no command received, motors stopped");
  }
}

void publishTelemetry() {
  if (!deviceConnected || telemetryChar == nullptr) {
    return;
  }

  unsigned long now = millis();
  if (now - lastTelemetryTime < TELEMETRY_INTERVAL_MS) {
    return;
  }
  lastTelemetryTime = now;

  int distance = 0;  // CSV text-v1 placeholder until hardware sensor read is wired.
  int irLeft = 0;
  int irRight = 0;

  String telemetry = String(distance) + "," + String(irLeft) + "," + String(irRight);
  telemetryChar->setValue(telemetry.c_str());
  telemetryChar->notify();
}

void setup() {
  Serial.begin(115200);
  ACB_SmartCar.Init();
  ACB_SmartCar.Move(Stop, 0);

  BLEDevice::init("QD001-BLE");

  BLEServer* pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  BLECharacteristic* commandChar = pService->createCharacteristic(
    COMMAND_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  commandChar->setCallbacks(new CommandCallbacks());

  telemetryChar = pService->createCharacteristic(
    TELEMETRY_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  telemetryChar->addDescriptor(new BLE2902());

  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Ready — waiting for connection");
  Serial.println("[BLE] Device name: QD001-BLE");
  Serial.print("[BLE] Service UUID: ");
  Serial.println(SERVICE_UUID);
}

void loop() {
  processBleEvents();
  processFailsafe();
  publishTelemetry();
  delay(10);
}
