---
name: qd001-leds-buzzer
description: Use when writing or debugging Arduino (.ino) code for the Acebott QD001 ESP32 MAX that controls the two on-board LEDs (digital on/off, blink, PWM dimming), the piezo buzzer (tones, melodies, app music songs), or PWM / analog output in general. Covers pin assignments, the analogWrite() vs ledc core 2.x/3.x gotcha, and the 4 built-in app-music songs.
---

# QD001 — LEDs, Buzzer y PWM

Skill de referencia para los **periféricos de salida básicos** del robot Acebott QD001 ESP32 MAX: los dos LEDs, el buzzer piezoeléctrico y el PWM/salida analógica del ESP32. Todo el contenido está respaldado por la wiki local autoritativa (`.llm-wiki/wiki/`). Lo que no está documentado ahí, no está aquí.

## Cuándo usarla

- Escribís o depurás código `.ino` que prende/apaga/parpadea los LEDs del QD001.
- Querés hacer dimming PWM de los LEDs ("breathing light").
- Necesitás hacer sonar el buzzer con `tone()` / `noTone()` o componer una melodía.
- Estás integrando LEDs con movimiento (luces según dirección).
- Migrás el core de Arduino-ESP32 y se rompió `analogWrite()` (gotcha del core 2.x → 3.x).
- Querés saber qué canciones reproduce el botón "Music" de la app Acebott.

> **No ejecutes nada automáticamente.** Los comandos y sketches de esta skill son solo REFERENCIA. Flashear/subir firmware requiere confirmación explícita del usuario.

## Pines (QD001)

| Periférico | Pin | Modo |
| --- | --- | --- |
| LED izquierdo (`leftLed`) | **12** | digital OUT / PWM |
| LED derecho (`rightLed`) | **2** | digital OUT / PWM |
| Buzzer | **33** | `tone()` / `noTone()` |

Fuente: `concepts/leds-and-buzzer-peripherals.md`, confirmado en `analyses/appcontrolcar2-full-firmware.md` (`#define Buzzer 33`).

## LEDs — API

### On/off digital (curso 2.2.1)

```cpp
#define leftLed 12
#define rightLed 2

pinMode(leftLed, OUTPUT);
pinMode(rightLed, OUTPUT);

digitalWrite(leftLed, HIGH);   // on
digitalWrite(rightLed, HIGH);
delay(1000);
digitalWrite(leftLed, LOW);    // off
digitalWrite(rightLed, LOW);
```

### Blink / integración con movimiento (curso 2.2.2)

Patrón del curriculum: las luces indican la dirección.

```cpp
// Adelante: ambos LEDs on
digitalWrite(leftLed, HIGH); digitalWrite(rightLed, HIGH);

// Girar a izquierda: solo LED izquierdo on
digitalWrite(leftLed, HIGH); digitalWrite(rightLed, LOW);

// Girar a derecha: solo LED derecho on
digitalWrite(leftLed, LOW); digitalWrite(rightLed, HIGH);

// Parar: parpadean 10 veces
for (int i = 0; i < 10; i++) {
  digitalWrite(leftLed, HIGH); digitalWrite(rightLed, HIGH);
  delay(100);
  digitalWrite(leftLed, LOW); digitalWrite(rightLed, LOW);
  delay(100);
}
```

### Blink NO bloqueante con `millis()` — concurrencia con otra salida

Los ejemplos de curso son todos `delay()`-based, y `delay()` **congela todo el `loop()`** — si querés que el LED parpadee **mientras** sonás un tono, movés un servo, o leés un sensor, el `delay()` te bloquea. Usá el patrón `millis()` (máquina de estados no bloqueante):

```cpp
#define leftLed 12
#define rightLed 2

unsigned long prevBlink = 0;
const unsigned long blinkInterval = 300;  // ms on/off
bool ledState = false;

void setup() {
  pinMode(leftLed, OUTPUT);
  pinMode(rightLed, OUTPUT);
}

void loop() {
  unsigned long now = millis();

  // Blink no bloqueante: chequea si pasó el intervalo, sin detener el loop
  if (now - prevBlink >= blinkInterval) {
    prevBlink = now;
    ledState = !ledState;
    digitalWrite(leftLed, ledState);
    digitalWrite(rightLed, ledState);
  }

  // Acá podés hacer OTRA cosa concurrentemente (tone, servo, lectura de sensor)
  // sin que el blink la congele — el loop sigue corriendo libre.
}
```

> **Cuándo usarlo:** cuando el blink tiene que coexistir con otra salida (un tester necesitó blink concurrente con `tone()`/movimiento). El `delay()`-based solo sirve si el LED es lo ÚNICO que hace el loop. Regla: `delay()` = bloqueante (un solo hilo); `millis()` + state = no bloqueante (pseudo-concurrencia cooperativa).

### Dimming PWM — "breathing light" (curso 2.3 / 2.5)

```cpp
int lightness = 255;
while (lightness > 0) {
  analogWrite(leftLed, lightness);
  analogWrite(rightLed, lightness);
  delay(10);
  lightness = lightness - 5;  // fade out en pasos de 5
}
```

`analogWrite(pin, value)` con `value` 0–255 (0 = 0% duty, 255 = 100% duty). **Ver el gotcha del core más abajo**: esto solo compila con core < 3.0.

## Buzzer — API

### Tono simple

```cpp
#define Buzzer 33

tone(Buzzer, 440);   // La (A4), suena hasta noTone()
delay(500);
noTone(Buzzer);      // silencio
```

### Melodía (curso 2.4.1 — BuzzerMusic)

Notas como frecuencias (Hz):

```cpp
#define Buzzer 33

#define C4 262
#define D4 294
#define E4 330
#define F4 349
#define G4 392
#define A4 440
#define B4 494

int tune[] = { C4, C4, G4, G4, A4, A4, G4 /*, ... */ };
float durt[] = { 1, 1, 1, 1, 1, 1, 2 /*, ... */ };  // duración en pulsos
int bpm = 100;

for (int x = 0; x < 28; x++) {
  tone(Buzzer, tune[x]);
  delay(60000 / bpm * durt[x]);
  noTone(Buzzer);
}
```

**Fórmula de duración**: `delay_ms = 60000 / bpm * durt[x]`.

> **Aclaración de afinación:** `C4 = 262 Hz` es **261.63 Hz redondeado** (altura exacta del Do central en el **temperamento igual**, A4 = 440 Hz). El redondeo a entero no es audible para el oído (la diferencia está por debajo del umbral de JND), pero si necesitás precisión (ej. afinar contra otra fuente), usá `262` como aproximación del `261.63` teórico. Lo mismo aplica a las demás notas de la tabla (valores enteros del curso).

## App Music — 4 canciones built-in (firmware AppControlCar2)

El firmware `AppControlCar2` (el que usa la app móvil Acebott) trae **4 canciones pre-cargadas** que se disparan desde el botón "Music" de la app. El buzzer las reproduce con las notas definidas en 3 octavas (C3–B5). Cada canción usa `N` (0) como silencio (rest), y las duraciones se miden en pulsos musicales.

| Índice | Canción | Rango de notas |
| --- | --- | --- |
| 0 | Twinkle Twinkle Little Star | C4–C5 |
| 1 | Jingle Bells | E4–G4 |
| 2 | Happy New Year | C5–G5 |
| 3 | Old MacDonald (Have a Farm) | C4–G3 |

Fuente: `analyses/autonomous-modes-appcontrolcar2.md` ("App Music — 4 built-in songs"). El firmware reporta versión `0.12.21` por serie.

> **Nota**: estos nombres/índices son del firmware de la **app**. Si escribís tu propio sketch con `tone()` (como el curso 2.4.1), componés tu propia melodía; estas canciones no están como arrays listos en la wiki del curso, solo en el firmware AppControlCar2.

## PWM y salida analógica en ESP32 (teoría)

PWM (Pulse Width Modulation) conmuta un pin digital entre HIGH (3.3V) y LOW (0V) rápido; el **duty cycle** controla el voltaje promedio.

| Duty cycle | Voltaje (ESP32 3.3V) |
| --- | --- |
| 0% | 0 V |
| 25% | 0.825 V |
| 50% | 1.65 V |
| 75% | 2.475 V |
| 100% | 3.3 V |

- Función Arduino: `analogWrite(pin, value)`, `value` 0–255.
- Mayor `value` = LED más brillante / motor más rápido.

### `dacWrite` / advanced PWM

La wiki de este skill **no documenta** `dacWrite()` ni el uso avanzado con librería `ESP32PWM` + `allocateTimer()` (eso vive en `concepts/servo-pan-control.md` para servos). Para PWM de varios canales avanzados, ver la skill de servos / esa página. No lo fabriques aquí si no está.

## Gotchas

1. **`analogWrite()` NO funciona con Arduino-ESP32 core 3.0+** — es el gotcha #1. El QD001 usa core **2.0.18** (`arduino:esp32@2.0.18-arduino.5`, instalado vía `arduino-cli`), donde `analogWrite()` compila y funciona. Si actualizás a core 3.x, tenés que migrar a `ledcAttach(pin, freq, resolution)` + `ledcWrite(pin, duty)`. La API vieja del core 2.x (`ledcSetup`/`ledcAttachPin`/`ledcWrite` con canal) **también cambió** en 3.x. Verificá la versión del core antes de escribir PWM.

2. **Pines 34–39 NO soportan PWM** (ni output en general) — son input-only en el ESP32. Todos los demás pines con capacidad de output soportan PWM. Los pines del QD001 usados aquí (12, 2, 33) están OK.

3. **`tone()` usa un timer interno** — en el core 2.0.18 convive con `analogWrite()` sin conflicto aparente para estos sketches. Si mezclas muchos timers (servos + buzzer + PWM multicanal), podés necesitar `ESP32PWM` con `allocateTimer()` para gestionar canales manualmente (ver skill de servos).

4. **Canales PWM**: la wiki del curso trata PWM como "un pin = un `analogWrite`" y no detalla la asignación manual de canales LEDC. Ese detalle (canal, frecuencia, resolución) no está documentado para LEDs/buzzer — solo aparece para servos. Si lo necesitás, está fuera del alcance de esta skill.

5. **Frecuencias audibles del buzzer**: las notas musicales (C3≈131 Hz a B5≈988 Hz) caen en el rango audible del buzzer piezo. `tone()` maneja la generación de onda cuadrada; no uses `analogWrite()` para el buzzer (querés una frecuencia fija audible, no un duty cycle).

6. **LEDs y PWM se superponen con la skill `qd001-motors-mecanum`**: el PWM es el mismo mecanismo físico del ESP32, pero los motores se controlan con la librería `ACB_SmartCar_V2` (abstracción de alto nivel), mientras que LEDs/buzzer usan Arduino puro (`analogWrite`/`tone`). Si trabajás ambos, recordá que la gestión de timers/canales PWM puede interactuar — no está documentado el conflicto concreto en la wiki.

## Fuentes (wiki)

- `concepts/leds-and-buzzer-peripherals.md` — pines, on/off, blink, breathing light, buzzer music (curso 2.2.x, 2.3, 2.4.1, 2.5).
- `concepts/pwm-and-analog-output.md` — teoría PWM, duty cycle, `analogWrite()`, restricciones ESP32 (pines 34-39, core 3.0+).
- `analyses/appcontrolcar2-full-firmware.md` — `#define Buzzer 33`, 3 octavas de notas (C3-B5), expansión vía app.
- `analyses/autonomous-modes-appcontrolcar2.md` — las 4 canciones del app music con rangos, `N`=silencio, firmware 0.12.21.
- `concepts/arduino-ide-setup-macos.md` — core instalado `2.0.18` (confirma que `analogWrite` funciona; gotcha core 3.x).
