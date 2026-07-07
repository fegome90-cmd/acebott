---
name: qd001-servo-scan
description: Use when writing or debugging QD001 ESP32 MAX code that drives the pan servo (GPIO25) — centering/calibrating the ultrasonic mount, app-driven head panning, or the obstacle-avoidance left/right scan sweep. Covers ESP32Servo API, angles, scan timing, and the WiFi timer-conflict gotcha.
---

# QD001 — Servo Pan & Scan

Reference for the **single pan servo** on the Acebott QD001 ESP32 MAX. The servo
pivots the HC-SR04 ultrasonic sensor left/right so the robot can "look around"
before choosing a path. Two use modes: static centering (calibration / app
control) and dynamic **scan sweep** for autonomous obstacle avoidance.

> **NOTA — todo comando y código aquí es REFERENCIA derivada de la wiki local.**
> Verificar pines y flashear requiere confirmación del usuario. Nada debe
> ejecutarse sin revisión.

> **SCOPE**: Esta skill cubre SOLO el servo pan (GPIO25) y su uso en el scan de
> obstacle-avoidance. Para los motores mecanum ver `qd001-motors-mecanum`, para
> el HC-SR04 ver `qd001-sensors`, y para el flasheo ver `acebott-esp32-flash`.

## Cuándo usarla

- Centrando mecánicamente el servo/horn del sensor ultrasónico antes de ajustar.
- Escribiendo firmware de control por app que mueve el "cuello" del robot.
- Implementando o depurando el **barrido (scan) left/right** de obstacle-avoidance.
- Dudas sobre la lib `ESP32Servo`, el pin, los ángulos (0/90/180), o delays de
  barrido.
- Errores de timer conflict cuando WiFi y servo corren juntos.

## Hardware & Pin

| Ítem | Valor |
|------|-------|
| Función | Pan del sensor ultrasónico (cuello/cabeza) |
| Pin (servoPin) | **GPIO 25** |
| Library | **`ESP32Servo.h`** (de `3.Archivo de biblioteca/ESP32Servo.zip`) |
| Origen lib | Derivada del bundle `ACB_SmartCar_V2` |
| Sensor asociado | HC-SR04 (trig=13, echo=14 en el sketch de obstacle-avoid) |

## API ESP32Servo (referencia)

```cpp
#include <ESP32Servo.h>

Servo myservo;          // (la app firmware lo llama Yservo)
int servoPin = 25;

myservo.attach(servoPin);
myservo.write(angle);   // ángulo en grados, 0–180
```

### Ángulos del pan

| Ángulo | Dirección |
|--------|-----------|
| `0°`   | Derecha   |
| `90°`  | Centro (al frente) |
| `180°` | Izquierda |

> El centro canónico es **90°**. La calibración se hace sosteniendo el servo en
> 90° mientras se ajusta mecánicamente el horn y la montura del HC-SR04.

## Sketch de calibración (3.3.1) — centrado en 90°

Use este sketch para centrar el servo ANTES de apretar la montura del sensor:

```cpp
#include <ESP32Servo.h>
#include <ACB_SmartCar_V2.h>

Servo myservo;
int servoPin = 25;

void setup() {
  ACB_SmartCar.Init();
  delay(1000);
  myservo.attach(servoPin);
}

void loop() {
  myservo.write(90);   // center position
}
```

## Modo App Control (4.4.1) — pan dirigido por app

El firmware `APPControlCar` nombra el servo `Yservo` en pin 25 y el ángulo llega
desde la app (default 90°):

```cpp
#define Yservo_PIN  25
Servo Yservo;
Yservo.attach(Yservo_PIN);
Yservo.write(angle);   // angle default 90, ajustable desde la app
```

## Patrón de Barrido (Scan) — Obstacle Avoidance Upgrade

Basado en el sketch `3.3.2ObstacleAvoidanceUpgrade`. El servo panea el sensor
para medir izquierda y derecha y elegir el lado más despejado.

### Pin setup del scan

```cpp
myUltrasonic.Init(13, 14);   // trig=13, echo=14
myServo.attach(25);          // pan servo
```

### Algoritmo (7 pasos)

1. Servo centrado (90°), leer distancia al frente.
2. Si hay obstáculo a < **25 cm** → **STOP**.
3. Pan a **0°** (derecha) → leer `right_distance`.
4. Pan a **180°** (izquierda) → leer `left_distance`.
5. Re-centrar servo a **90°**.
6. Decisión:
   - Ambos lados < **20 cm** → Backward + spin (retirada).
   - Derecha más despejada → Backward + **Clockwise** (girar derecha).
   - Izquierda más despejada → Backward + **Contrarotate** (girar izquierda).
   - Empate → default girar derecha.

> **Dos thresholds distintos — no son contradictorios:**
> - **25 cm** = umbral de **detección de obstáculo** (canónico, ver `qd001-sensors`). Define si hay algo al frente y dispara el STOP inicial. Es el threshold "hay obstáculo".
> - **20 cm** = umbral de **retirada cuando ambos lados están bloqueados**. Es más bajo a propósito: solo se entra en la maniobra de retroceso+spin si NINGÚN lado ofrece un pasaje realista (< 20 cm). Si algún lado está entre 20 y 25 cm, igual se elige el más despejado y se gira hacia ahí.
>
> Contextos distintos: 25 cm = "detecté algo", 20 cm = "no hay escape lateral, me retiro". No mezclar.
7. Si el camino está libre (> 25 cm) → **Forward**.

> **Cross-ref:** la firma de `Move()` y las constantes enum de dirección (`Forward`/`Backward`/`Clockwise`/`Contrarotate`/`Stop`) → ver skill `qd001-motors-mecanum`.

### Timing del barrido (delays críticos)

| Delay | Valor | Motivo |
|-------|-------|--------|
| Pan a posición | **500 ms** | tiempo de viaje físico del servo |
| Settle entre lecturas | **200 ms** | estabilización del eco ultrasónico |
| Backward antes de girar | **500 ms** | delay del sketch `3.3.2ObstacleAvoidanceUpgrade` (línea 39: `delay(500)` tras `Move(Backward,180)`). Es **maniobra táctica de retroceso** del algoritmo de evasión, NO el mínimo de librería. El mínimo técnico para destrabar el giro es ~150ms (ver `qd001-motors-mecanum` gotcha #1). Son 2 contextos distintos, no mezclar. |

> **Nota — timing del spin NO documentado en la wiki.** El `delay()` exacto que va **después** de `Move(Clockwise,...)` / `Move(Contrarotate,...)` (es decir, cuánto dura el giro antes de volver a `Forward`) **no figura en la wiki fuente**. Requiere **ajuste físico** (empírico): depende de la superficie, carga de la batería y la velocidad del spin. Empezá con un valor tentativo (ej. 500–800 ms) y ajustá observando cuánto rota el robot hasta lograr el ángulo deseado. Tratar como **no documentado**.

## Gotchas

1. **`ESP32Servo` requiere `ESP32Servo.h`, NO `Servo.h` estándar.** Usar el
   header de ESP32 o compila pero no genera PWM correctamente en GPIO25.

2. **Timer conflict con WiFi.** Cuando WiFi está activo (ej. firmware de app
   control), DEBE llamarse `ESP32PWM::allocateTimer(1)` ANTES de
   `servo.attach()`. Si no, el servo y el WiFi pelean por el mismo hardware
   timer y uno de los dos falla silenciosamente. Esto aplica al modo app; el
   sketch de obstacle-avoid autónomo (sin WiFi) no lo necesita.

3. **Backward pulse antes de girar.** El sketch `3.3.2ObstacleAvoidanceUpgrade`
   usa `Move(Backward,...)` + `delay(500)` antes de girar como **maniobra
   táctica de retroceso** del algoritmo de evasión (línea 39). NO es el mínimo
   de librería: el mínimo técnico para destrabar el giro es **~150ms** (ver
   `qd001-motors-mecanum` gotcha #1). Son 2 contextos distintos — no mezclar.

4. **El centro es 90°, no "0°".** Para centrar el sensor usá `write(90)`. Los
   extremos del barrido son 0° y 180°; respetá esos límites — pasarlos no da
   más rango, solo fuerza el servo contra sus topes mecánicos.

5. **Respetá los delays de pan (500 ms).** Si leés la distancia antes de que el
   servo termine de viajar, medís el ángulo equivocado. El servo físico tarda
   en llegar a posición; sin el delay el scan queda desincronizado.

6. **Alimentación del servo — no documentada en la wiki fuente.** Servos SG90
   típicos pueden consumir picos que el LDO del ESP32 no aguanta; alimentación
   separada / común bien filtrada es práctica habitual, pero la wiki no lo
   confirma para el QD001. Tratar como **no documentado** hasta verificar el
   esquemático de la placa.

## Fuentes (wiki)

- `concepts/servo-pan-control.md` — lib, wiring, calibración, modo app, timer conflict.
- `concepts/obstacle-avoidance-with-servo-scan.md` — algoritmo de barrido, ángulos, delays, backward-pulse.
- `entities/qd001-pin-map.md` — confirma Servo (pan) = GPIO25, ESP32Servo library.
