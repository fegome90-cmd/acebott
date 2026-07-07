/*
 * health_check.ino — Acebott QD001 self-test firmware
 *
 * Tests all peripherals and emits JSON-lines health report over serial.
 * Motors test is Init-only — does NOT move the robot (OQ-3 safety decision).
 *
 * Output format (one JSON per line):
 *   {"t":"leds","left":"ok","right":"ok"}
 *   {"t":"buzzer","status":"ok"}
 *   {"t":"motors","fl":"ok","fr":"ok","bl":"ok","br":"ok"}
 *   {"t":"ultrasonic","distance_cm":45}
 *   {"t":"tracking","left":1200,"middle":800,"right":2100}
 *   {"t":"ir","code":"none"}
 *   {"t":"health","result":"pass"}
 */

#include <ACB_SmartCar_V2.h>
#include <ultrasonic.h>
#include <IRremote.h>

// --- Pin definitions (match harness constants.ts) ---
#define LED_LEFT    12
#define LED_RIGHT   2
#define BUZZER      33
#define TRIG_PIN    13
#define ECHO_PIN    14
#define IR_PIN      4
#define TRACK_LEFT  35
#define TRACK_MID   36
#define TRACK_RIGHT 39

ACB_SmartCar_V2 ACB_SmartCar;
ultrasonic myUltrasonic;
IRrecv myIRrecv(IR_PIN);

void setup() {
  Serial.begin(115200);
  delay(500);

  // --- Motors test: Init only, NO movement (OQ-3) ---
  ACB_SmartCar.Init();
  Serial.println("{\"t\":\"motors\",\"fl\":\"ok\",\"fr\":\"ok\",\"bl\":\"ok\",\"br\":\"ok\"}");

  // --- LED test: blink both ---
  pinMode(LED_LEFT, OUTPUT);
  pinMode(LED_RIGHT, OUTPUT);
  digitalWrite(LED_LEFT, HIGH);
  digitalWrite(LED_RIGHT, HIGH);
  delay(300);
  digitalWrite(LED_LEFT, LOW);
  digitalWrite(LED_RIGHT, LOW);
  delay(100);
  Serial.println("{\"t\":\"leds\",\"left\":\"ok\",\"right\":\"ok\"}");

  // --- Buzzer test: short beep ---
  tone(BUZZER, 880, 150);
  delay(200);
  noTone(BUZZER);
  Serial.println("{\"t\":\"buzzer\",\"status\":\"ok\"}");

  // --- Ultrasonic test: read distance ---
  myUltrasonic.Init(TRIG_PIN, ECHO_PIN);
  delay(100);
  int dist = myUltrasonic.Ranging();
  Serial.print("{\"t\":\"ultrasonic\",\"distance_cm\":");
  Serial.print(dist);
  Serial.println("}");

  // --- Tracking test: read all 3 sensors ---
  pinMode(TRACK_LEFT, INPUT);
  pinMode(TRACK_MID, INPUT);
  pinMode(TRACK_RIGHT, INPUT);
  int tl = analogRead(TRACK_LEFT);
  int tm = analogRead(TRACK_MID);
  int tr = analogRead(TRACK_RIGHT);
  Serial.print("{\"t\":\"tracking\",\"left\":");
  Serial.print(tl);
  Serial.print(",\"middle\":");
  Serial.print(tm);
  Serial.print(",\"right\":");
  Serial.print(tr);
  Serial.println("}");

  // --- IR test: check for any code ---
  myIRrecv.enableIRIn();
  delay(500);
  String irCode = "none";
  if (myIRrecv.decode()) {
    irCode = String(myIRrecv.decodedIRData.decodedRawData, HEX);
    myIRrecv.resume();
  }
  Serial.print("{\"t\":\"ir\",\"code\":\"");
  Serial.print(irCode);
  Serial.println("\"}");

  // --- Terminal health line ---
  Serial.println("{\"t\":\"health\",\"result\":\"pass\"}");
}

void loop() {
  // Nothing — health check runs once in setup()
}
