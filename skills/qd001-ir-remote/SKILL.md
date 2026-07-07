---
name: qd001-ir-remote
description: Use when working on IR remote control for the Acebott QD001 ESP32 MAX car — receiving IR signals, decoding button HEX codes from the official Acebott remote, mapping codes to movement actions, or building firmware that combines remote control with autonomous modes (line tracking, obstacle avoidance, music). Covers the IRremote library usage on pin 4, the full button→code→action table, repeat-code handling, and the 100ms safety timeout.
---

# QD001 — Control por IR Remote

Skill para controlar el robot **Acebott QD001 ESP32 MAX** mediante el control remoto IR oficial. Cubre recepción de señales, decodificación, tabla de HEX codes del remote Acebott, mapeo a acciones de `ACB_SmartCar`, y firmware integrado (manual + modos autónomos).

Todo el contenido está respaldado por la wiki local autoritativa `.llm-wiki/wiki/`. Si algo no está documentado, se marca explícitamente.

## Cuándo usarla

- Escribir/modificar firmware `.ino` que reciba IR en el QD001.
- Decodificar un remote Acebott o mapear un remote distinto al oficial.
- Integrar control IR con modos autónomos (tracking, obstacle avoidance, música).
- Debuggear botones que "no responden" (repeat codes, timeout, codes hex erróneos).

## Librería y pines

| Item | Valor |
|------|-------|
| Librería | `IRremote` (zip en `3.Archivo de biblioteca/IRremote.zip`) |
| Pin del receptor IR | **4** (`#define IRpin 4`) |
| Protocolo | No documentado explícitamente como "NEC" en la wiki — los codes se leen vía `decodedIRData.decodedRawData` (raw). El remote Acebott emite codes terminados en `FF00`. |
| API principal | `IRrecv myIRrecv(IRpin)` → `myIRrecv.enableIRIn()` → `myIRrecv.decode()` → `myIRrecv.decodedIRData.decodedRawData` → `myIRrecv.resume()` |

Setup mínimo:

```cpp
#define IRpin 4
IRrecv myIRrecv(IRpin);

void setup() {
  myIRrecv.enableIRIn();
}
```

## Decodificar un remote arbitrario (sketch `4.1IRremoteTest`)

Antes de mapear codes a acciones, descubrí los HEX de TU remote:

```cpp
if (myIRrecv.decode()) {
  Serial.println(myIRrecv.decodedIRData.decodedRawData, HEX);
  myIRrecv.resume();  // wait for next reading
}
```

Esto imprime el raw hex de cada botón. Anotá cada valor y reemplazá los `case 0xXXXXXXXX:` del sketch de control.

## Tabla HEX Codes → Acción (remote Acebott oficial)

Estos son los codes **del remote Acebott oficial**, leídos vía `decodedIRData.decodedRawData`. Todos terminan en `FF00`.

### Control manual (sketch `4.2.1IRremoteCar`)

| Botón | HEX Code | Acción `ACB_SmartCar` |
|-------|----------|----------------------|
| Up (▲) | `0xB946FF00` | Forward |
| Down (▼) | `0xEA15FF00` | Backward |
| Left (◀) | `0xBB44FF00` | Contrarotate (gira sobre sí mismo a izquierda) |
| Right (▶) | `0xBC43FF00` | Clockwise (gira sobre sí mismo a derecha) |
| 1 | `0xE916FF00` | Move_Left (strafe) |
| 3 | `0xF20DFF00` | Move_Right (strafe) |

### Modos autónomos extra (sketch `4.2.2ExpandProgram` — capstone módulo 4)

Suma estos botones a los anteriores para activar/desactivar modos autónomos:

| Botón | HEX Code | Acción |
|-------|----------|--------|
| **4** | `0xF30CFF00` | **Entrar en modo line-tracking** (sigue línea) |
| **6** | `0xA15EFF00` | **Entrar en modo obstacle avoidance** (scan con servo) |
| **2** | `0xE619FF00` | **Tocar música** (Twinkle Twinkle Little Star, vía buzzer) |
| 5 | `0xE718FF00` | **Salir** del modo autónomo (vuelve a control manual) |

> **Aclaración importante — el botón 5 NO es "Stop".** El remote Acebott **NO tiene botón de Stop**: el botón 5 (`0xE718FF00`) es **"exit modo autónomo"** (setea `mode_state = false` y rompe el bucle `while` de tracking/avoidance/music). La **parada física** de los motores no se logra con ningún botón, sino **soltando el botón de dirección** + el **timeout de 100ms** del firmware que fuerza `Move(Stop, 0)` (ver Gotchas #2). Son dos semánticas distintas: botón 5 = salir de modo autónomo; soltar + timeout = detener motores. No confundir.

### Codes NO documentados en la wiki

La wiki NO documenta los HEX de los botones **0, 7, 8, 9** ni de botones especiales (OK/Setup/etc.) del remote Acebott. Si los necesitás, descubrilos con el sketch `4.1IRremoteTest`. Tampoco documenta un botón explícito de "Parada" — la parada se logra soltando el botón (timeout de 100ms, ver Gotchas).

## Firmware integrado — patrón de state machine (`4.2.2ExpandProgram`)

El capstone integra control IR manual + modos autónomos + música. El patrón de cambio de modo es:

```cpp
bool mode_state = false;

case 0xF30CFF00:  // button 4
  mode_state = true;
  tracking();      // entra en bucle while(mode_state)
  break;
```

**Cómo funciona el puente manual ↔ autónomo:**

1. Un botón setea `mode_state = true`.
2. La función autónoma corre en un `while(mode_state)` bloqueante (usa `motorControl()` directo en vez de `Move()` para control fino).
3. **Dentro del bucle se sigue poleando IR** — por eso el botón 5 puede romperlo.
4. Botón 5 (`0xE718FF00`) setea `mode_state = false` → sale del bucle → vuelve a manual.

Las funciones autónomas (`tracking()`, `ObstacleAvoidance()`, `music()`) son las mismas que en sus sketches dedicados. `ObstacleAvoidance()` usa helpers `ultrasonic_ranging()`, `back_clock()`, `back_anticlock()` con el pulso de 150ms hacia atrás antes de girar.

## Código de referencia — recepción + repeat + timeout

```cpp
#include <IRremote.h>
#define IRpin 4

IRrecv myIRrecv(IRpin);

unsigned long lastCommandTime = 0;
const unsigned long commandTimeout = 100;
unsigned long current_decode = 0;
unsigned long last_decode = 0;

void setup() {
  myIRrecv.enableIRIn();
}

void loop() {
  if (myIRrecv.decode()) {
    current_decode = myIRrecv.decodedIRData.decodedRawData;

    // Repeat-code handling: si el flag de repeat está seteado,
    // reusar el último code en vez del raw (que es basura en repeat)
    if (myIRrecv.decodedIRData.flags) {
      current_decode = last_decode;
    } else {
      last_decode = current_decode;
    }

    switch (current_decode) {
      case 0xB946FF00: ACB_SmartCar.Move(Forward, 255);     break;
      case 0xEA15FF00: ACB_SmartCar.Move(Backward, 255);    break;
      case 0xBB44FF00: ACB_SmartCar.Move(Contrarotate, 255);break;
      case 0xBC43FF00: ACB_SmartCar.Move(Clockwise, 255);   break;
      case 0xE916FF00: ACB_SmartCar.Move(Left, 255);        break;
      case 0xF20DFF00: ACB_SmartCar.Move(Right, 255);       break;
      // 4.2.2 ExpandProgram agrega: 0xF30CFF00, 0xA15EFF00, 0xE619FF00, 0xE718FF00
    }

    lastCommandTime = millis();
    myIRrecv.resume();
  }

  // Safety timeout: si no llega IR en 100ms, parar (evita runaway)
  if (millis() - lastCommandTime > commandTimeout) {
    ACB_SmartCar.Move(Stop, 0);
  }
}
```

> Nota: los nombres exactos de las constantes de dirección (`Forward`, `Stop`, etc.) y la firma de `Move()` provienen de la lib `ACB_SmartCar_V2`. **Cross-ref: firma de `Move()` y constantes enum (`Forward`/`Stop`/`Backward`/`Contrarotate`/`Clockwise`/etc.) → ver skill `qd001-motors-mecanum`** (un tester aislado no las encontró desde aquí). El bloque `switch` arriba es ilustrativo del patrón documentado en la wiki.

## Gotchas

1. **Repeat codes (`flags` bit)** — Cuando mantenés un botón apretado, la lib IRremote setea un bit en `flags` y `decodedRawData` NO contiene el code válido. Siempre checkeá `decodedIRData.flags` y reusá el último code válido (`last_decode`). Sin esto, mantener apretado "adelante" se interrumpe o produce acciones erráticas.

2. **Safety timeout de 100ms** — El auto **no tiene botón de Stop** en el remote; la parada se logra soltando el botón. Si no llega ningún IR en `commandTimeout` (100ms), el firmware fuerza `Move(Stop, 0)`. Sin esto, si el remote deja de transmitir (batería, obstáculo entre remote y sensor), el auto sigue con el último comando = runaway.

3. **`resume()` obligatorio** — Después de cada `decode()` exitoso hay que llamar `myIRrecv.resume()` para preparar la próxima lectura. Olvidarlo = se lee un único botón y se congela.

4. **Codes terminan en `FF00`** — Todos los codes del remote Acebott terminan en `FF00`. Si al decodificar tu remote ves codes sin ese sufijo (o de otra longitud), es OTRO remote o protocolo — usá `4.1IRremoteTest` para mapearlo y reemplazá los `case`.

5. **Protocolo no explicitado como NEC** — La wiki NO confirma que el remote Acebott use protocolo NEC. Trabaja a nivel raw (`decodedRawData`). No asumas NEC ni intentes `decode_type` sin verificar primero.

6. **Remote distinto al oficial** — Los HEX de arriba son del remote Acebott oficial. Si tu kit trae otro remote (o usás uno universal), los codes serán distintos. Flujo: `4.1IRremoteTest` → anotá HEX por botón → reemplaza `case`.

7. **Bucle autónomo bloquea pero sigue leyendo IR** — En `4.2.2ExpandProgram`, las funciones `tracking()`/`ObstacleAvoidance()` corren en `while(mode_state)`, pero **dentro del bucle se polea IR**. Esto es por diseño: permite salir con el botón 5. No rompas ese patrón poniendo el poleo solo afuera.

## Fuentes (wiki)

- `.llm-wiki/wiki/concepts/ir-remote-control.md` — librería, pin, API básica, sketch de test.
- `.llm-wiki/wiki/analyses/ir-remote-car-hex-codes.md` — tabla HEX manual (6 botones), repeat-code handling, safety timeout.
- `.llm-wiki/wiki/analyses/ir-remote-integrated-firmware.md` — HEX de modos autónomos (4 botones extra), state machine `mode_state`, funciones autónomas.
