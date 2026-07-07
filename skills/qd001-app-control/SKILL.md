---
name: qd001-app-control
description: Use when working on the QD001 ESP32 MAX "control por app/web" — the Acebott mobile app protocol, the binary TCP frame format on port 100, WiFi AP setup, autonomous modes (FOLLOW / TRACK_1 / TRACK_2 / AVOID), the appcontrolcar2 firmware, or the iOS Safari web-control rendering bug. Covers both the native app (TCP) and the browser alternative (HTTP).
---

# QD001 — Control por App/Web

Skill autoritativa sobre el control del robot Acebott **QD001 ESP32 MAX** desde la app móvil oficial y desde un navegador. Todo el contenido proviene de la wiki local en `.llm-wiki/wiki/`. Si un dato no figura aquí, treat it as "no documentado" y verificá antes de afirmarlo.

## Cuándo usarla

Usá esta skill cuando:

- Alguien pregunte cómo la app Acebott habla con el robot (protocolo binario sobre TCP).
- Haya que entender o depurar el formato del paquete `0xFF 0x55 ...` en el puerto 100.
- Se trabaje con el firmware `4.4.1APPControlCar1` o `4.4.2APPControlCar2`.
- Se necesiten detalles de los modos autónomos (`FOLLOW`, `TRACK_1`, `TRACK_2`, `AVOID`).
- Alguien reporte que la página de control web no se ve bien en iPhone Safari.
- Se quiera saber cómo el robot levanta su propio WiFi AP (`ESP32-Car` / `ESP32-CAR`).

> NOTA: Hay **dos mecanismos de control distintos**, no los mezcles:
> - **App nativa** → protocolo binario propio sobre **TCP puerto 100** (este es el principal).
> - **Navegador web** → HTTP servido por el firmware `4.3Web_control_car` (alternativa, con bug en iOS Safari).

---

## Arquitectura general

El QD001 puede operar en dos modos de control remoto, ambos sobre WiFi:

```
┌─────────────┐         WiFi AP (ESP32-Car)        ┌──────────────────┐
│  App ACEBOTT │ ──── TCP socket puerto 100 ────► │  QD001 (ESP32)    │
│  (iOS/Andr)  │     frames binarios 0xFF 0x55     │  appcontrolcar2   │
└─────────────┘                                  └──────────────────┘

┌─────────────┐         WiFi AP (ESP32-Car)        ┌──────────────────┐
│  Navegador   │ ──── HTTP puerto 80 (fetch) ───► │  QD001 (ESP32)    │
│  (browser)   │                                  │  4.3Web_control   │
└─────────────┘                                  └──────────────────┘
```

El robot actúa como **Access Point**. El cliente (app o navegador) se conecta al WiFi del robot, no a una red externa. No hay internet ni servicios en la nube de por medio.

---

## WiFi AP (cómo el robot levanta su red)

- El firmware arranca el ESP32 en modo **Access Point**.
- **SSID**: `ESP32-Car` (algunas páginas wiki lo citan como `ESP32-CAR`; la diferencia mayúsculas/minúsculas puede ser inconsistencia de documentación — verificá en el monitor serie si dudás).
- **Password**: `12345678`

> Estos valores (`ESP32-Car` / `12345678`) son **datos del firmware**, documentados en la wiki. NO son secretos del usuario. NUNCA le pidas al usuario su SSID/password reales, y si los ve distintos a estos, reportá lo documentado como referencia, no lo que el usuario tenga configurado en casa.

**Flujo de conexión (app):**
1. Ensamblá el robot, encendé (switch a la derecha).
2. En el teléfono: WiFi → conectate a `ESP32-Car` (pass `12345678`).
3. Abrí la app ACEBOTT → "SmartCar" → "Control".
4. Tocá el ícono de conectar (arriba-derecha) — se enciende al conectar.

**Si el WiFi `ESP32-Car` no aparece**: el robot no está corriendo firmware de control por app. Hay que flashear `4.4.2APPControlCar2` (ver `[[flash-workflow-canonical]]`).

---

## Protocolo TCP puerto 100 (formato del paquete)

### Transporte

- **TCP server en el puerto 100** — NO es HTTP. Socket TCP crudo.
- Implementación: `WiFiServer server(100)` + `WiFiClient client`.
- La app nativa habla **frames binarios**, no texto ni HTTP.

### Formato del frame

```
┌──────┬──────┬────────┬───────────────────────────────────────┐
│ 0xFF │ 0x55 │ <len>  │  <payload...>                          │
└──────┴──────┴────────┴───────────────────────────────────────┘
 header  header dataLen    bytes 3..N (escritos en buffer[])
```

- **Header**: `0xFF` seguido de `0x55`.
  - El `0x55` **solo cuenta** si fue precedido por `0xFF` (esto evita falsos positivos si `0x55` aparece en el payload).
- **Byte 2** (`dataLen`): contador de bytes restantes del payload. **Se decrementa por cada byte recibido a partir del índice 3**; cuando llega a `0` el frame se considera completo y se llama a `parseData()`.
- **Payload**: bytes 3 en adelante, escritos en `buffer[]` por `writeBuffer(index_a, c)`.

#### No hay checksum (confirmado contra `.ino`)

El firmware **NO implementa checksum**. Ni lo calcula al recibir ni lo valida (`rg "checksum"` sobre el `.ino` devuelve cero hits). La integridad del frame se asume por TCP (que ya garantiza entrega ordenada y sin corrupción). El cierre del frame es **por contador `dataLen == 0`**, no por un byte de verificación. Cualquier mención a "checksum opcional" en docs más viejas es incorrecta — no existe en el código.

#### `readBuffer()` — qué es (confirmado contra `.ino`)

`readBuffer(int index_r)` es un accessor trivial sobre el array global `char buffer[52]`:

```cpp
unsigned char readBuffer(int index_r) { return buffer[index_r]; }
void writeBuffer(int index_w, unsigned char c) { buffer[index_w] = c; }
```

Es decir, `readBuffer(9)` devuelve `buffer[9]`. El índice es la posición absoluta dentro de `buffer[]`, que se va llenando byte a byte conforme llega el frame (ver state machine abajo).

#### Por qué los offsets son 9 / 10 / 12 (y qué hay en los bytes 3–8)

`parseData()` lee tres posiciones fijas:

```cpp
int action = readBuffer(9);   // comando (CMD_RUN=1, etc.)
int device = readBuffer(10);  // subsistema destino
int val    = readBuffer(12);  // parámetro
```

Los bytes intermedios **sí se reciben y quedan en `buffer[]`**, pero el firmware de control de movimiento **no los lee**:

| byte | contenido | lo usa `parseData()` |
|------|-----------|----------------------|
| 0–1  | header `0xFF 0x55` (no se escriben en `buffer[]`; solo disparan `isStart`) | — |
| 2    | `dataLen` | solo como contador |
| 3–8  | payload reservado / no usado por este firmware | **no** |
| 9    | `action` | sí |
| 10   | `device` | sí |
| 11   | payload reservado / no usado | **no** |
| 12   | `val` | sí |
| 13+  | payload adicional (ej. params de otros devices) | según `runModule()` |

**Off-by-one warning**: los offsets 9/10/12 son **altos a propósito** porque el formato Acebott/Makeblock-like reserva bytes al frente del payload. Si construís un cliente custom y mandás `action` en la posición 3 (como en un protocolo típico), el firmware lo lee como `buffer[3]` y `readBuffer(9)` devuelve basura → el robot no responde. Tu payload debe alinearse con los offsets fijos del firmware (action en la 6ª posición del payload, device en la 7ª, val en la 9ª).

> **Nota sobre bytes 3–8 y 11**: el `.ino` confirma que `parseData()` solo lee `buffer[9,10,12]` y que `runModule()` usa `readBuffer(12)` para `val`. El **contenido específico** que la app oficial pone en los bytes 3–8 y 11 NO está documentado en este `.ino` (probablemente IDs de módulo/sub-comandos para expansiones QD003/QD005/QD007/QD009). Si lo necesitás, hay que capturarlo con un sniffer TCP entre la app y el robot — **no confirmado contra el `.ino`**.

### Parser — state machine

El firmware reconstruye el paquete byte a byte en `buffer[]`:

```cpp
if (c == 0x55 && isStart == false) {
  if (prevc == 0xff) {   // 0x55 solo arranca si vino después de 0xFF
    index_a = 1;
    isStart = true;
  }
}
// ... acumular en buffer[] hasta que dataLen == 0
```

Rastrea `index_a` y decrementa `dataLen` hasta que el frame completo llegó.

### Dispatch — `parseData()`

Una vez parseado, lee action / device / val en posiciones fijas del buffer:

```cpp
int action = readBuffer(9);   // CMD_RUN=1, CMD_GET=2
int device = readBuffer(10);  // qué subsistema
int val    = readBuffer(12);  // parámetro
```

### Comandos de movimiento (device `0x0C`)

| `val`  | Acción |
|--------|--------|
| `0x01` | Forward (avanzar) |
| `0x02` | Backward (retroceder) |
| `0x03` | Move_Left (strafe izq) |
| `0x04` | Move_Right (strafe der) |
| `0x09` | Contrarotate (spin izq) |
| `0x0A` | Clockwise (spin der) |
| `0x00` | Stop |

### Velocidad (device `0x0D`)

Setea la variable `Speed` (rango 0–255).

### Ejemplo de frame completo: "Avanzar" (Forward) — reconstruido del `.ino`

Para disparar `CMD_RUN` (action=1) sobre device `0x0C` (movimiento) con `val=0x01` (Forward), el frame debe dejar caer esos valores en `buffer[9]`, `buffer[10]` y `buffer[12]` respectivamente. Reconstruyendo la aritmética del parser (`index_a` arranca en 1 al recibir `0x55`, y cada byte posterior se escribe en `buffer[index_a]` con `index_a++` al final):

```
FF 55 09 00 00 00 00 00 00 01 0C 00 01 00
^^ ^^ ^^                            ^^ ^^ ^^ ^^
 |  |  |                             |  |  |  |
 |  |  |                             |  |  |  +-- buffer[12] = val = 0x01 (Forward)
 |  |  |                             |  |  +----- buffer[11] = 0x00 (no usado)
 |  |  |                             |  +-------- buffer[10] = device = 0x0C (movimiento)
 |  |  |                             +----------- buffer[9]  = action = 0x01 (CMD_RUN)
 |  |  +-- buffer[2] = dataLen = 0x09 (9 bytes de payload: bytes 3..11 + val)
 |  +----- 0x55 (header 2) — solo arranca porque prevc == 0xFF
 +-------- 0xFF (header 1, queda en prevc)
```

Bytes `00` en posiciones 3–8 y 11: el firmware no los lee, así que su valor es indiferente **para este comando**. Se muestran como `00` porque la app oficial probablemente los rellena así, pero **esto no está confirmado contra el `.ino`** (ver nota anterior).

> **`dataLen = 0x09`**: el parser decrementa `dataLen` por cada byte desde el índice 3 hasta que llega a 0, momento en que dispara `parseData()`. Como el último byte útil es `buffer[12]` (índice absoluto 12, que es el byte recibido en la iteración donde `index_a==12`), `dataLen` debe cubrir exactamente hasta ahí. El valor **exacto** de `dataLen` que la app oficial envía no está impreso en el `.ino` — se deduce del loop del parser. Tratá `0x09` como **deducido, no confirmado literalmente contra el `.ino`**; si tu frame no dispara `parseData()`, ajustá `dataLen` (sumá o restá 1) hasta que el robot responda.

**Mínimo viable para testing**: si solo querés que el robot avance y no te preocupa el relleno, el esqueleto es:

```
FF 55 <len> [6 bytes de relleno] 01 0C <1 byte> 01 <byte final>
```

donde `action=0x01` cae en la 6ª posición del payload, `device=0x0C` en la 7ª, y `val=0x01` en la 9ª. Verificá con un sniffer TCP contra el frame real de la app oficial antes de afirmar valores exactos.

### Byte especial: `200`

Recibir el byte `200` setea `st = true`, usado como **marcador de conexión viva** en la lógica de timeout (3s sin datos → desconecta).

### Servo

La app también controla el servo de pan (`Yservo_PIN` = 25), ajustando `angle` (default 90°).

---

## Modos autónomos

El firmware `4.4.2APPControlCar2` implementa comportamientos autónomos **conmutables desde la app**. Esto es lo más potente del control por app: no es solo joystick manual, la app dispara algoritmos que corren en el loop principal.

### Comandos (constantes CMD)

| Comando        | Valor | Modo                          |
|----------------|-------|-------------------------------|
| `CMD_RUN`      | 1     | Movimiento manual             |
| `CMD_GET`      | 2     | Consultar telemetría          |
| `CMD_STANDBY`  | 3     | Standby                       |
| `CMD_TRACK_1`  | 4     | Line tracking (2 sensores)    |
| `CMD_TRACK_2`  | 5     | Line tracking (3 sensores)    |
| `CMD_AVOID`    | 6     | Obstacle avoidance            |
| `CMD_FOLLOW`   | 7     | Object follow                 |

### State machine de modo

```cpp
enum FUNCTION_MODE {
  STANDBY,
  FOLLOW,
  TRACK_1,   // 2-sensor line tracking
  TRACK_2,   // 3-sensor line tracking
  AVOID,     // obstacle avoidance
} function_mode;
```

La app setea `function_mode` vía el protocolo binario; `functionMode()` despacha al algoritmo correspondiente en cada iteración del loop.

### Qué hace cada modo / qué sensor usa

| Modo     | Función           | Comportamiento                                                            | Sensor / hardware                              |
|----------|-------------------|---------------------------------------------------------------------------|------------------------------------------------|
| `STANDBY`| (idle)            | Sin movimiento, esperando comandos                                        | —                                              |
| `FOLLOW` | `model3_func()`   | Sigue un objeto según distancia ultrasónica                               | Sensor ultrasónico (distancia)                 |
| `TRACK_1`| (2 sensores)      | Sigue línea con sensores izq/der                                          | `Left_Line`, `Right_Line`                      |
| `TRACK_2`| (3 sensores)      | Sigue línea con izq/medio/der                                             | `Left_Line` (35), `Center_Line` (36), `Right_Line` (39) |
| `AVOID`  | `model4_func()`   | Evita obstáculos con barrido del servo                                    | Ultrasónico + servo scan (`Yservo_PIN`/`Tservo_PIN`) |

### Umbrales de línea (off-road)

Constantes del firmware de tracking:

```cpp
int Black_Line = 2000;   // sobre línea negra
int Off_Road   = 4000;   // sensor levantado de la superficie
```

`Off_Road` detecta cuando el robot es levantado en peso o se sale del mapa, permitiendo que el firmware se detenga de forma segura.

### Velocidad autónoma default

```cpp
int speeds = 250;   // velocidad autónoma default
```

---

## Firmware `appcontrolcar2` (referencia completa)

El sketch más avanzado (`4.4.2APPControlCar2.ino`), derivado de la lib oficial `ACB_SmartCar_V2`. Agrega cámara, shooter (QD005), servo dual y modos autónomos disparados desde la app.

### Pines adicionales vs APPControlCar1

```cpp
#define Shoot_PIN    32   // Trigger del shooter (pulso 150ms) - QD005
#define Yservo_PIN   25   // Servo de pan
#define Tservo_PIN   26   // Servo de tilt (nuevo)
#define LED_Module1   2
#define LED_Module2  12
#define Left_Line    35
#define Center_Line  36
#define Right_Line   39
#define Buzzer       33
```

### Soporte de cámara

Incluye `esp_camera.h` — este firmware está diseñado para el pack de cámara **QD002**. El panel central de la app es para el feed de cámara. Sin el módulo de cámara, el servidor TCP de control igual funciona.

Bootea imprimiendo `Camera Ready!` por serie.

### Música (disparada desde la app)

4 canciones built-in reproducibles desde la app vía el buzzer:

| Índice | Canción                  | Rango de notas |
|--------|--------------------------|----------------|
| 0      | Twinkle Twinkle Little Star | C4–C5       |
| 1      | Jingle Bells             | E4–G4         |
| 2      | Happy New Year           | C5–G5         |
| 3      | Old MacDonald (Have a Farm) | C4–G3       |

Cada canción usa `N` (0) como silencio (rest). El firmware define 3 octavas de frecuencias de notas (C3–B5).

### Versión de firmware

Reportada por serie como `Firmware Version is 0.12.21`.

### Conciencia de expansion packs

Este único firmware soporta **TODOS** los packs de expansión vía la fila de botones de abajo de la app:

- LED, música, line-follow, avoid, follow (built-in QD001)
- Shooter (QD005), brazo robótico (QD007), GPS (QD009), IA (QD003)
- Cámara (QD002)

### Layout de control de la app

- **Panel izq**: joystick de movimiento (forward, backward, strafe, spin)
- **Números del medio**: ajuste de velocidad
- **Fila inferior**: botones de función
- **Panel central**: feed de cámara (requiere QD002)
- **Slider derecho**: control pan/tilt del servo

### Botones inferiores de la app

| Botón           | Función              | Requiere    |
|-----------------|----------------------|-------------|
| LED             | Toggle LEDs          | built-in    |
| Music           | Reproduce melodía    | built-in    |
| Line-follow mode| Tracking autónomo    | built-in    |
| Avoid mode      | Obstacle avoidance   | built-in    |
| Follow mode     | Object following     | built-in    |
| Shoot           | Lanzador             | pack QD005  |
| Robotic arm     | Control del brazo    | pack QD007  |
| GPS             | Ubicación            | pack QD009  |
| AI              | Inteligencia artificial | pack QD003 |

---

## Bug iOS Safari (control web)

### Síntoma

La página HTML de control servida por `4.3Web_control_car` **no se renderiza bien en iPhone Safari**, a pesar de que la conexión WiFi funciona y el servidor responde (confirmado por monitor serie).

### Causa raíz (hipótesis — verificar)

El HTML servido por `handleRoot()` **no tiene el viewport meta tag** y depende de `onmousedown`/`onmouseup` que se comportan de forma inconsistente en touch de iOS Safari.

### HTML servido (extracto)

```html
<html>
<style> body {
  -webkit-user-select: none;
  -khtml-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
}</style>
<body>
  <center><h1>moveCar control</h1></center>
  <center>
    <button onmousedown="moveCar('tl')" onmouseup="moveCar('s')"
            ontouchstart="moveCar('tl')" ontouchend="moveCar('s')"
            style="width:200px;height:250px">Trun left</button>
    <button onmousedown="moveCar('f')" onmouseup="moveCar('s')"
            ontouchstart="moveCar('f')" ontouchend="moveCar('s')"
            style="width:200px;height:250px">Forward</button>
    <!-- ... más botones ... -->
  </center>
  <script>
    function moveCar(move) {
      fetch('/Car?move=' + move);
    }
  </script>
</body></html>
```

### Problemas sospechados

1. **Sin viewport meta tag** — iOS Safari puede renderizar a ancho de desktop, causando problemas de layout/zoom. Falta: `<meta name="viewport" content="width=device-width, initial-scale=1">`
2. **Duplicación de touch events** — `ontouchstart` + `onmousedown` disparan ambos en iOS, potencialmente enviando comandos duplicados (press + stop inmediato).
3. **Sin `preventDefault()` en touch events** — iOS puede sintetizar un mouse event después del touch, causando doble disparo.
4. **`fetch()` sin await/error handling** — si un request falla, no hay retry ni feedback.

### Pasos de aislamiento (antes de fixear)

Aislar en uno de:
1. El servidor no recibe el HTTP request
2. El servidor responde pero el iPhone no lo recibe
3. El iPhone recibe el HTML pero Safari no puede renderizarlo
4. El HTML llega corrupto/truncado

**Test rápido**: desde iPhone Safari, navegar a `http://192.168.4.1/` y usar el visor de código fuente (o `curl` desde una laptop en el mismo WiFi) para confirmar que el HTML llega intacto.
- Si llega intacto → es un problema de rendering/JS (causas 1–3).
- Si llega truncado → es un problema de MTU/transferencia.

### Fix propuesto (borrador)

```html
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
```

Más aislar `ontouchstart` de `onmousedown` con feature detection, y llamar `e.preventDefault()` en los handlers de touch.

---

## Gotchas

1. **Puerto 100, no 80.** El protocolo de la app es **TCP puerto 100**, no HTTP. Si alguien dice "es un HTTP server" para la app nativa, está confundiendo con el control web (`4.3Web_control_car`). Son dos cosas distintas.
2. **`0x55` solo arranca el frame si viene después de `0xFF`.** Si no validás el `prevc == 0xff`, vas a parsear basura cada vez que `0x55` aparezca dentro de un payload.
3. **SSID inconsistente en la wiki.** Algunas páginas dicen `ESP32-Car`, otras `ESP32-CAR`. Verificá en el monitor serie antes de afirmar cuál es el correcto para el firmware específico.
4. **Double-trigger touch en iOS.** Si un botón tiene `ontouchstart` Y `onmousedown`, iOS puede disparar ambos → comando + stop inmediato. Usar `preventDefault()` y feature detection.
5. **Off-road detection.** Con `Off_Road = 4000`, si levantás el robot o se sale de la línea, el firmware se detiene solo. No es un bug, es un safety.
6. **La app dispara algoritmos, no solo comandos puntuales.** Cuando seteás `function_mode` (FOLLOW/TRACK/AVOID), el loop principal corre ese algoritmo hasta que cambiés de modo. Olvidar desactivarlo = el robot "se mueve solo".
7. **El `4.4.2APPControlCar2` es superconjunto del `4.4.1APPControlCar1`.** Si querés todos los modos autónomos + cámara + shooter, usá el 2. El 1 es lo básico de movimiento.
8. **Sin cámara el TCP igual funciona.** El `esp_camera.h` está incluido pero si no hay módulo QD002, el control por app (TCP puerto 100) sigue operando.
9. **Byte `200` = keepalive.** La lógica de timeout (3s sin datos) desconecta al cliente. Si estás escribiendo un cliente custom, mandá `200` periódicamente o vas a perder la conexión.
10. **Bug Safari = hipótesis.** La página wiki marca la causa raíz como "hypothesis, to verify". No lo afirmes como hecho confirmado sin reproducirlo.

---

## Fuentes (wiki)

- `analyses/app-control-car-protocol.md` — protocolo binario, formato del frame, state machine del parser, dispatch de comandos.
- `analyses/appcontrolcar2-full-firmware.md` — firmware completo, pines, modos autónomos (CMD constants), cámara, música, expansion packs.
- `analyses/autonomous-modes-appcontrolcar2.md` — enum `FUNCTION_MODE`, algoritmos por modo, umbrales `Black_Line`/`Off_Road`, canciones.
- `analyses/webcontrolcar-ios-safari-bug.md` — síntoma, HTML servido, problemas sospechados, pasos de aislamiento, fix propuesto.
- `concepts/WiFi Control Car Sketch.md` — **stub** (solo lint placeholder, sin contenido propio).
- `entities/acebott-app-mobile-control.md` — instalación de la app, flujo de conexión, layout de control, botones inferiores, firmware requerido.

---

## Superposición con otras skills

- **`qd001-ir-remote`**: control alternativo por IR (no WiFi). Distinto canal de control; este skill es solo WiFi/app.
- **`qd001-sensors`** (line tracking, ultrasónico): los modos autónomos `TRACK_*`, `AVOID`, `FOLLOW` **usan** esos sensores. Acá los consumimos desde el firmware de app; los detalles del sensor están en la skill de sensors.
- **`qd001-motors`**: el protocolo de la app termina seteando movimiento (forward/backward/strafe/spin) que ejecuta el módulo de motores. Esta skill define los valores `0x01`–`0x0A`; cómo se traducen a PWM/pines es tema de motors.
