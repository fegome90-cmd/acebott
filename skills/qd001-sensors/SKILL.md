---
name: qd001-sensors
description: Use when writing or debugging QD001 ESP32 MAX sensor code — HC-SR04 ultrasonic distance/obstacle avoidance and IR reflectance line-tracking (2 or 3 sensors). Covers pins (TRIG=13/ECHO=14, IR=35/36/39), the ultrasonic library API, analog thresholds (Black_Line=2000, Off_Road=4000), the TRACK_1/TRACK_2 algorithms, and calibration. Loads BEFORE writing sensor-related .ino sketches.
---

# QD001 — Sensores (HC-SR04 + Line Tracking)

Los "sensores del robot" QD001 ESP32 MAX son dos grupos:

1. **Ultrasonido HC-SR04** — un sensor de distancia para detectar obstáculos.
2. **IR reflectancia (line-tracking)** — 2 o 3 sensores para seguir una línea negra sobre fondo blanco.

Ambos cuelgan del ESP32 y se consumen vía la lib `ACB_SmartCar_V2` (movimiento) más, en el caso del ultrasonido, la lib `ultrasonic` empaquetada.

## Cuándo usarla

- Escribís o depurás un `.ino` del QD001 que **lee distancia** (obstacle avoidance, ranging).
- Escribís o depurás un `.ino` de **seguimiento de línea** (2 o 3 sensores).
- Necesitás **calibrar** los sensores IR o diagnosticar por qué el robot no sigue la línea.
- Verificás pines, thresholds o la API de `ultrasonic` / `analogRead`.

No cubre: motores puros, servo pan, app/Bluetooth, IR remote. Esos viven en skills hermanas (`qd001-motors`, `qd001-app-control`, modos autónomos).

---

## HC-SR04 — Sensor ultrasónico (distancia / obstáculos)

### Wiring — pines TRIG / ECHO

| Pin ESP32 | Función HC-SR04 |
|-----------|-----------------|
| **13**    | TRIG (trigger)  |
| **14**    | ECHO            |

> `myUltrasonic.Init(13, 14);` siempre en ese orden: **(trig, echo)**.

### Librería y API

Se usa la lib empaquetada `ultrasonic` (en el curso: `3.Archivo de biblioteca/ultrasonic.zip`), NO `pulseIn()` directo.

```cpp
#include <ultrasonic.h>

ultrasonic myUltrasonic;

void setup() {
  myUltrasonic.Init(13, 14);     // (trig, echo)
}

void loop() {
  int distance = myUltrasonic.Ranging();  // devuelve distancia en CM (int)
}
```

| Método             | Retorno | Descripción                          |
|--------------------|---------|--------------------------------------|
| `Init(trig, echo)` | —       | Configura pines (llamar en `setup`). |
| `Ranging()`        | `int`   | Distancia al obstáculo en **cm**.    |

> **Getter canónico — NO inventar métodos.** El getter de distancia es **`myUltrasonic.Ranging()`** con `ultrasonic.h`, instanciado como `ultrasonic myUltrasonic;` e inicializado con `myUltrasonic.Init(trig, echo)`. **No existe `GetDistance()`** (ni `getDistance`, ni `readDistance`) en esta lib — un tester lo inventó; no es parte de la API. Si tu sketch usa `GetDistance()`, no compila. Firmas canónicas:
> ```cpp
> #include <ultrasonic.h>
> ultrasonic myUltrasonic;
> myUltrasonic.Init(13, 14);      // setup: (trig, echo)
> int cm = myUltrasonic.Ranging(); // loop: devuelve cm como int
> ```

> La fórmula física (velocidad del sonido ~0.0343 cm/µs, distancia = tiempo/2) está encapsulada dentro de la lib. A nivel sketch solo llamás `Ranging()` y recibís cm. No documentado en la wiki: timeout interno ni filtrado de ecos — la lib lo maneja opaco.

> **Gotcha — `Ranging()` es BLOQUEANTE y opaca.** La lib `ultrasonic.h` espera el pulso ECHO sin timeout configurable expuesto ni filtrado de ecos múltiples documentado. Esto tiene dos consecuencias prácticas:
> - **Bloquea el loop** mientras espera el eco. En scans rápidos consecutivos (ej. servo pan left/right/front en sucesión), un eco **rezagado de la lectura anterior puede contaminar** la siguiente lectura (medís "fantasmas" del disparo previo).
> - **Recomendación: lectura "warm-up" descartable.** Antes de la lectura que vale, hacé una llamada `Ranging()` extra y **descartá** su valor. Esto deja que cualquier eco pendiente se disipe y estabiliza el siguiente disparo. Útil sobre todo en el scan con servo (`qd001-servo-scan`), donde las 3 lecturas (front/left/right) se toman en rápida sucesión tras mover el servo.
>
> No documentado en la wiki fuente — práctica defensiva derivada del comportamiento opaco de la lib.

### Rango y threshold de seguridad

- **Threshold de detección de obstáculo: 25 cm** (valor **canónico** del curso 3.2). Es el umbral "hay algo delante".
- Si `UT_distance <= 25` → hay obstáculo; si `> 25` → libre.

> **Contexto cruzado — el 20 cm de `qd001-servo-scan` NO contradice este 25 cm.** El scan con servo (3.3.2) usa un segundo umbral de **20 cm** para la rama "retirada cuando ambos lados están bloqueados". Son thresholds con propósitos distintos: aquí **25 cm = detección**; allá **20 cm = trigger de retirada bilateral**. Mismo sensor, dos decisiones distintas. Ver `qd001-servo-scan` para el detalle del algoritmo.

### Código de referencia — Ranging puro (sketch 3.1)

```cpp
#include <ACB_SmartCar_V2.h>
#include <ultrasonic.h>

ultrasonic myUltrasonic;
ACB_SmartCar_V2 ACB_SmartCar;
int UT_distance = 0;

void setup() {
  ACB_SmartCar.Init();
  Serial.begin(115200);
  myUltrasonic.Init(13, 14);
}

void loop() {
  UT_distance = myUltrasonic.Ranging();
  Serial.print(UT_distance);
  Serial.println("cm");
  delay(1000);
}
```

### Código de referencia — Obstacle Avoidance (sketch 3.2)

```cpp
#include <ACB_SmartCar_V2.h>
#include <ultrasonic.h>

ACB_SmartCar_V2 ACB_SmartCar;
ultrasonic myUltrasonic;
int UT_distance = 0;

void setup() {
  ACB_SmartCar.Init();
  myUltrasonic.Init(13, 14);
}

void loop() {
  UT_distance = myUltrasonic.Ranging();
  if (UT_distance <= 25) {                  // obstáculo dentro de 25 cm
    ACB_SmartCar.Move(Contrarotate, 180);   // girar a la izquierda
    delay(1500);
    ACB_SmartCar.Move(Stop, 0);
  } else {
    ACB_SmartCar.Move(Forward, 150);        // avanzar
  }
}
```

> REQUIERE CONFIRMACIÓN DEL USUARIO antes de flashear/ejecutar: poner el robot en superficie despejada y, si usás la variante con servo (`3.3.2ObstacleAvoidanceUpgrade`), orientar el buz del servo para que el HC-SR04 apunte **hacia adelante**.

### Upgrade con servo (3.3.2)

`3.3.2ObstacleAvoidanceUpgrade` añade un servo que hace **pan** (escanea izquierda/derecha) antes de decidir para qué lado girar. Lo maneja la skill de servo, no esta.

### Modelo conceptual — ciclo Detect → Judge → Act

La evasión no es una lectura suelta, es un **loop continuo**:

```
DETECT (Ranging lee distancia) → JUDGE (¿<= 25 cm?) → ACT (Forward / girar / stop)
                                                              └──────── vuelve a DETECT
```

Es una aplicación directa de **estructura condicional** (`if / else if / else`).

---

## Line-Tracking — Sensores IR de reflectancia

### Cantidad de sensores: 2 vs 3

| Config | Sketch                         | Sensores usados      |
|--------|--------------------------------|----------------------|
| TRACK_1 | `3.4.2TrackingWithTwoSensor`  | Left + Right         |
| TRACK_2 | `3.5TrackingWithThreeSensor`  | Left + Middle + Right |

El QD001 físico lleva 3 sensores IR; el de en medio (pin 36) solo se usa en la variante de 3.

### Wiring — pines analógicos

| Sensor  | Pin ESP32 | Sketch donde aparece |
|---------|-----------|----------------------|
| Left    | **35**    | 3.4.2, 3.5           |
| Middle  | **36**    | 3.5 (solo 3 sensores)|
| Right   | **39**    | 3.4.2, 3.5           |

Todos se leen con **`analogRead()`** (lectura analógica, NO digital). Configurados como `INPUT` con `pinMode`.

### Thresholds

```cpp
int Black_Line = 2000;   // umbral negro/blanco
//  valor < 2000  → sensor SOBRE línea NEGRA
//  valor >= 2000 → sensor sobre fondo BLANCO

int Off_Road = 4000;     // (solo en APPControlCar2) sensor levantado de la superficie
```

> Lectura `>= 4000` → el robot fue levantado o se salió del mapa. Solo lo implementa el firmware completo (`4.4.2APPControlCar2`), no los sketches de curso.

### Calibración

El umbral `2000` es un default del curso. Si el robot no sigue la línea, **medí y recalculá**:

```cpp
// 1. Robot sobre línea NEGRA  → black_value = analogRead(sensor)
// 2. Robot sobre fondo BLANCO → white_value = analogRead(sensor)
// 3. Umbral = punto medio:
Black_Line = (black_value + white_value) / 2;
```

Motivo: el IR es sensible a la **luz ambiente**, que puede hacer que el ESP32 confunda blanco con negro (falsos positivos).

### Código de referencia — Test de sensores IR (sketch 3.4.1)

Útil para calibrar: imprime los valores crudos al monitor serie (115200 baud).

```cpp
#include <ACB_SmartCar_V2.h>

#define Left_sensor 35
#define Right_sensor 39
ACB_SmartCar_V2 ACB_SmartCar;

void setup() {
  ACB_SmartCar.Init();
  Serial.begin(115200);
  pinMode(Left_sensor, INPUT);
  pinMode(Right_sensor, INPUT);
}

void loop() {
  Serial.print("Left_sensor_value:");
  Serial.println(analogRead(Left_sensor));
  Serial.print("Right_sensor_value:");
  Serial.println(analogRead(Right_sensor));
  delay(1000);
}
```

### Algoritmo TRACK_1 — 2 sensores (sketch 3.4.2)

```cpp
int Black_Line = 2000;
int Speed = 180;

Left_Tra_Value  = analogRead(Left_sensor);   // pin 35
Right_Tra_Value = analogRead(Right_sensor);  // pin 39

if (Left < Black && Right < Black)            Move(Forward, Speed);       // ambos en línea
else if (Left >= Black && Right < Black)      Move(Contrarotate, Speed);  // izq fuera → girar izq
else if (Left < Black && Right >= Black)      Move(Clockwise, Speed);     // der fuera → girar der
else if (Left >= Black && Right >= Black)     Move(Stop, 0);              // ambos fuera
```

> Mismo `Speed` (180) para avanzar y girar. Una sola velocidad.

### Algoritmo TRACK_2 — 3 sensores (sketch 3.5)

Suma el sensor medio (pin 36) y **separa velocidades**: `Speed = 200` (avance) y `RotateSpeed = 180` (giro).

```cpp
int Black_Line = 2000;
int Speed = 200;
int RotateSpeed = 180;

Left = analogRead(35); Middle = analogRead(36); Right = analogRead(39);

// (condiciones del sketch real; ver NOTA abajo sobre la convención de Middle)
if (L < Bl && M >= Bl && R < Bl)        Move(Forward, Speed);
if (L < Bl && M >= Bl && R >= Bl)       Move(Forward, Speed);
if (L >= Bl && M >= Bl && R < Bl)       Move(Forward, Speed);
else if (L >= Bl && M < Bl && R < Bl)   Move(Contrarotate, RotateSpeed);  // girar izq
else if (L < Bl && M < Bl && R >= Bl)   Move(Clockwise, RotateSpeed);     // girar der
else if (L >= Bl && M >= Bl && R >= Bl) Move(Forward, Speed);
```

> **NOTA — inconsistencia wiki vs código:** la página `line-tracking-sensors.md` describe el caso forward como *"middle on line"* (middle sobre negro, `< Black_Line`), pero el **código real del sketch 3.5** usa `Middle >= Black_Line` (= blanco) en esas ramas forward. Esto es una convención poco clara del fabricante. Si depurás seguimiento con 3 sensores, guiate por el código del `.ino`, no por la prosa de la wiki. (Gap documentado.)

---

## Gotchas

- **Luz ambiente** altera las lecturas IR → confunde blanco con negro. Recalibrá `Black_Line` con la fórmula del punto medio en el ambiente real de uso.
- **Robot demasiado lento** puede no tener inercia para seguir la línea → subí `Speed`. (Documento oficial de troubleshooting.)
- **Umbral `2000` es un default**, no una constante física. Superficies/cartas distintas necesitan otro valor.
- **`Off_Road = 4000`** solo existe en `APPControlCar2`; los sketches de curso no detectan "levantado del mapa".
- **Servo buz mirando adelante** antes de flashear obstacle-avoidance con servo (3.3.2).
- **Convención confusa de `Middle` en TRACK_2**: la prosa de la wiki y el código real no coinciden sobre si `Middle` "on line" es `<` o `>= Black_Line`. Fiarse del `.ino`.
- **`Ranging()` es bloqueante** y la lib maneja el timeout del echo de forma opaca — no está documentado el filtrado de ecos múltiples ni el rango máximo medible en la wiki.
- **Pines IR son analógicos**: se leen con `analogRead`, no `digitalRead`. Usar `pinMode(..., INPUT)`.
- Los sketches de curso imprimen a **115200 baud** — configurá el monitor serie igual.

---

## Fuentes (wiki)

- `.llm-wiki/wiki/concepts/ultrasonic-sensor-hc-sr04.md`
- `.llm-wiki/wiki/concepts/obstacle-avoidance-theory.md`
- `.llm-wiki/wiki/concepts/obstacle-avoidance-with-servo-scan.md`
- `.llm-wiki/wiki/concepts/line-tracking-sensors.md`
- `.llm-wiki/wiki/concepts/line-tracking-sensor-calibration.md`

## Sketches `.ino` reales verificados

- `Español/1.Tutoriales/Arduino (Alumno experimentado)/2.Procedimiento/3.1UltrasonicRanging/`
- `.../3.2ObstacleAvoidance/`
- `.../3.3.2ObstacleAvoidanceUpgrade/`
- `.../3.4.1Tracking_sensor_test/`
- `.../3.4.2TrackingWithTwoSensor/`
- `.../3.5TrackingWithThreeSensor/`
- `.../4.4.2APPControlCar2/` (firmware completo con `Off_Road`)

## Ver también (skills hermanas)

- `qd001-motors` — API `ACB_SmartCar.Move(dir, speed)` y direcciones (`Forward`, `Contrarotate`, `Clockwise`, `Stop`).
- `qd001-servo` — pan del servo para el upgrade 3.3.2.
- `qd001-app-control` — modos autónomos del firmware completo (donde se combina ultrasonido + line tracking + `Off_Road`).
