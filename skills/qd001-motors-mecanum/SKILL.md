---
name: qd001-motors-mecanum
description: Use when writing or debugging Arduino sketches (.ino) that drive the Acebott QD001 ESP32 MAX motors — the 4× TT Mecanum wheels behind the ACB_SmartCar_V2 library. Covers holonomic movement (forward/back/strafe/spin), the motorControl(id,speed) vs Move(direction,speed) APIs, motor ID-to-wheel layout, and the 150ms backward-pulse gotcha before spins.
---

# QD001 — Motores Mecanum

Skill de control motor del **Acebott QD001 ESP32 MAX V1.0**. El QD001 NO usa un puente H crudo (L298N/TB6612) expuesto al usuario: los 4 motores TT con ruedas Mecanum viven abstraídos detrás de la lib oficial **`ACB_SmartCar_V2`**. Toda interacción con los motores pasa por esa lib.

## Cuándo usarla

- Escribís o depurás un `.ino` del QD001 que mueve las ruedas.
- Necesitás strafe lateral (movimiento holonómico) o un giro sobre el eje.
- Querés mezclar control de alto nivel (`Move`) con control crudo por rueda (`motorControl`).
- El robot "no gira" y necesitás recordar el gotcha del pulso backward de 150ms.

No usar para: servos (ver `qd001-servo-scan` / servo pan), LEDs, buzzer, sensores, ni control por app/IR — eso es otra skill.

## API — ACB_SmartCar_V2

### Setup obligatorio

Todo sketch que mueva motores arranca igual:

```cpp
#include <ACB_SmartCar_V2.h>

ACB_SmartCar_V2 ACB_SmartCar;

void setup() {
  ACB_SmartCar.Init();  // Inicializa los 4 motores — OBLIGATORIO antes de cualquier movimiento
}
```

`Init()` se llama una sola vez en `setup()`. Sin esto, ningún `Move`/`motorControl` responde.

### `motorControl(motorId, speed)` — control crudo por rueda

Control directo de cada rueda. Usalo cuando necesitás vectores holonómicos custom.

- `motorId`: **1 a 4** (las 4 ruedas; ver layout abajo)
- `speed`: **-255 a 255** (negativo = reversa)

Ejemplo real del sketch `2.1.1GoSquare`:

```cpp
// Forward — las 4 ruedas mismas direccion
ACB_SmartCar.motorControl(1, 255);
ACB_SmartCar.motorControl(2, 255);
ACB_SmartCar.motorControl(3, 255);
ACB_SmartCar.motorControl(4, 255);

// Turn right — ruedas izq adelante, der reversa
ACB_SmartCar.motorControl(1, 255);
ACB_SmartCar.motorControl(2, 255);
ACB_SmartCar.motorControl(3, -255);
ACB_SmartCar.motorControl(4, -255);
```

### `Move(direction, speed)` — alto nivel (preferido)

Abstrae las combinaciones de ruedas. La dirección es una constante enum de la lib:

| Dirección        | Acción                          |
| ---------------- | ------------------------------- |
| `Forward`        | Avanza                          |
| `Backward`       | Retrocede                       |
| `Contrarotate`   | Gira izquierda (anti-horario)   |
| `Clockwise`      | Gira derecha (horario)          |
| `Move_Left`      | Strafe izquierda                |
| `Move_Right`     | Strafe derecha                  |
| `Stop`           | Detiene todos los motores       |

```cpp
ACB_SmartCar.Move(Forward, 150);
ACB_SmartCar.Move(Contrarotate, 180);
ACB_SmartCar.Move(Stop, 0);
```

## Layout de ruedas Mecanum (motor IDs 1-4)

Visto el robot desde arriba. Esquemas fuente: `2.1.1GoSquare` y `2.1.2ExpandProgram`.

```
     Front
   ┌───────┐
 1 │       │ 2    Izquierda = 1, 3   Derecha = 2, 4
   │       │
 3 │       │ 4
   └───────┘
     Back
```

### Vectores de movimiento por signo de speed

| Movimiento    | M1   | M2   | M3   | M4   |
| ------------- | ---- | ---- | ---- | ---- |
| Forward       | +255 | +255 | +255 | +255 |
| Turn Right    | +255 | +255 | -255 | -255 |
| Strafe Left   | -200 | +200 | +200 | -200 |
| Strafe Right  | +200 | +200 | -200 | -200 |
| Spin Left     | -200 | -200 | +200 | +200 |
| Spin Right    | +200 | +200 | -200 | -200 |

> El strafe lateral es lo que define a una rueda Mecanum — los rodillos a 45° convierten fuerza de rotación en vector lateral. Por eso cada posición de rueda tiene una orientación única.

## Pines

Los pines GPIO de los 4 motores **NO están documentados como expuestos al usuario** — la lib `ACB_SmartCar_V2` los gestiona internamente vía `Init()`. No hay `pinMode` manual ni asignación visible en los sketches del curso. El pin map del QD001 lista los motores como "managed by ACB_SmartCar_V2" sin pines concretos.

Si necesitás los pines físicos reales (para debugging de hardware o una lib propia), no están en la wiki — requeriría inspeccionar el source de la lib (`ACB_SmartCar_V2.cpp`).

## Gotchas

### 1. Pulso backward mínimo antes de spin (CRÍTICO)

**Gotcha — pulso Backward mínimo antes de girar**: `ACB_SmartCar_V2` necesita un `Move(Backward,...)` de al menos **~150ms** antes de `Contrarotate`/`Clockwise` para que el robot gire (mínimo empírico, repo ref `Emmanuelprime/acebott-qd001-pro`). OJO: el sketch oficial de evasión `3.3.2ObstacleAvoidanceUpgrade` usa **500ms** como maniobra táctica de retroceso (NO como mínimo de librería) — ver `qd001-servo-scan`. Son 2 contextos distintos.

```cpp
ACB_SmartCar.Move(Backward, 150);   // pulso previo OBLIGATORIO
delay(150);
ACB_SmartCar.Move(Contrarotate, 180);  // ahora sí gira
```

Si tu robot avanza/retrocede pero no gira, este es el culpable #1.

> **Nota — la skill da el PREREQUISITO del pulso backward (que el giro ocurra), NO la relación ms/grado → ángulo.** Es decir: sabés *qué* hacer para que gire, pero **no cuánto `delay()` de spin equivale a cuántos grados**. Esa relación (ej. "X ms de `Contrarotate` = 90°") **no está documentada** — depende de la superficie (fricción), la carga de la batería y la velocidad del spin. Un ángulo exacto (90°, 180°) requiere **calibración física empírica** por robot/entorno: medí, ajustá el delay, repetí. Tratar como no documentado.

### 2. Orientación física de las ruedas Mecanum

Las 4 ruedas Mecanum **NO son intercambiables** — cada posición tiene una rueda con orientación de rodillos única. Instaladas mal, el strafe se rompe (y a veces el forward queda raro). El manual de ensamblaje indica que los rodillos deben alinear con la dirección de la flecha de cada esquina.

### 3. `Move` vs `motorControl` — cuándo cuál

- `Move(direction, speed)` — para los 6 movimientos canónicos. Más simple, más legible.
- `motorControl(id, speed)` — cuando necesitás movimiento diagonal custom, mezclar velocidades por rueda, o trazar figuras como el "GoSquare".

### 4. Rango de speed

`-255` a `255`. Valores fuera de rango no están documentados — quedate dentro. Para arranques suaves usá valores intermedios (100-180); 255 es tope y drena más corriente.

## Instalación de la lib

Bundled en el material del curso:

```
Español/1.Tutoriales/Arduino (Alumno experimentado)/3.Archivo de biblioteca/ACB_SmartCar_V2.zip
```

O ya instalada en `~/Documents/Arduino/libraries/ACB_SmartCar_V2/`.

> Los comandos de instalación (descomprimir el zip, copiar a `libraries/`, compilar/flashear con `arduino-cli`) son **REFERENCIA** — requieren confirmación del usuario antes de ejecutarse. Esta skill no ejecuta builds ni flashes.

## Snippet completo de referencia

```cpp
#include <ACB_SmartCar_V2.h>

ACB_SmartCar_V2 ACB_SmartCar;

void setup() {
  ACB_SmartCar.Init();
}

void loop() {
  // Forward
  ACB_SmartCar.Move(Forward, 150);
  delay(1000);

  // Strafe derecha (Mecanum holonómico)
  ACB_SmartCar.Move(Move_Right, 150);
  delay(1000);

  // Giro anti-horario — REQUIERE pulso backward previo
  ACB_SmartCar.Move(Backward, 150);
  delay(150);
  ACB_SmartCar.Move(Contrarotate, 180);
  delay(500);

  ACB_SmartCar.Move(Stop, 0);
  delay(1000);
}
```

## Fuentes (wiki)

- `/Users/felipe_gonzalez/Developer/acebott/.llm-wiki/wiki/analyses/mecanum-wheel-motor-layout.md` — layout IDs 1-4, vectores de movimiento, orientación de rodillos
- `/Users/felipe_gonzalez/Developer/acebott/.llm-wiki/wiki/entities/acbsmartcarv2-library.md` — API `Init`/`motorControl`/`Move`, gotcha del pulso 150ms, instalación
- `/Users/felipe_gonzalez/Developer/acebott/.llm-wiki/wiki/concepts/smart-vehicle-architecture.md` — modelo pedagógico (percepción/decisión/ejecución), los motores como "execution system"
- `/Users/felipe_gonzalez/Developer/acebott/.llm-wiki/wiki/entities/qd001-pin-map.md` — confirma que los pines de motor los gestiona la lib internamente (no expuestos)
