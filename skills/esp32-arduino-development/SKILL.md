---
name: esp32-arduino-development
description: Use when working with ESP32 boards via the Arduino framework and arduino-cli toolchain — compiling sketches, flashing firmware, managing board cores/libraries, debugging upload failures, or using ESP32-specific Arduino APIs (GPIO/PWM, WiFi, NVS/Preferences).
---

# ESP32 + Arduino Development

Reference guide for ESP32 development (WROOM-32, S2, S3, C3, C6, CAM) using the
**Arduino framework** and **`arduino-cli`**. Covers compile, flash, library
management, serial debugging, and troubleshooting.

> **NOTA — todo comando aquí es REFERENCIA.** Ningún comando debe ejecutarse sin
> confirmación explícita del usuario.

> **PROJECT NOTE**: Este proyecto usa **esptool bundled ACECode @ 115200** para
> flashear, NO `arduino-cli upload` (fuerza 921600 baud → error 0xE0 en CH340).
> Ver skill `acebott-esp32-flash` para el workflow canónico. Los comandos
> `upload` de abajo son referencia general únicamente.

## Cuándo usarla

- Configurando o diagnosticando el entorno ESP32 + arduino-cli.
- Compilando sketches `.ino` para ESP32.
- Resolviendo errores típicos: `Failed to connect to ESP32: Timed out`, `No board
  selected`, `Library not found`, permisos de puerto serie.
- Trabajando con APIs específicas de ESP32 Arduino: `ledcAttach`/`ledcWrite`
  (PWM 3.x), `Preferences` (NVS), `WiFi`, touch pins, DAC.

## Conocimiento clave / Referencia

### 1. Toolchain

`arduino-cli` ya instalado vía `brew install arduino-cli` (v1.5.1+).
Configuración del core ESP32 (referencia — ejecutar solo si el usuario lo pide):

```bash
arduino-cli config init
arduino-cli config add board_manager.additional_urls https://dl.espressif.com/dl/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32
arduino-cli core list   # verificar instalación
```

### 2. FQBN (Fully Qualified Board Name)

| Placa | FQBN |
|-------|------|
| **ESP32 Dev Module** ← **QD001 usa esta** | `esp32:esp32:esp32` |
| ESP32-S2 | `esp32:esp32:esp32s2` |
| ESP32-S3 | `esp32:esp32:esp32s3` |
| ESP32-C3 | `esp32:esp32:esp32c3` |
| ESP32-C6 | `esp32:esp32:esp32c6` |
| NodeMCU-32S | `esp32:esp32:nodemcu-32s` |
| ESP32-CAM | `esp32:esp32:esp32cam` |

### 3. Compilar / Flashear (referencia de comandos)

```bash
# Compilar (autodetecta el .ino del directorio actual)
arduino-cli compile --fqbn esp32:esp32:esp32
arduino-cli compile --fqbn esp32:esp32:esp32 --verbose          # salida de depuración
arduino-cli compile --fqbn esp32:esp32:esp32 --output-dir ./build

# Identificar el puerto serie del ESP32 conectado
arduino-cli board list

# ⚠️ ACERCA DE UPLOAD: arduino-cli upload fuerza 921600 baud.
# En este proyecto se usa esptool bundled @ 115200 (ver acebott-esp32-flash).
# El comando de abajo es referencia general únicamente:
arduino-cli upload --fqbn esp32:esp32:esp32 -p /dev/cu.usbserial-110

# Opciones útiles de FQBN (compile)
:PartitionScheme=huge_app    # programa grande > partición por defecto
:FlashSize=4MB
:CPUFreq=240
:DebugLevel=debug
```

### 4. Modo descarga (bootloader)

- **Placas con auto-reset** (la mayoría con CH340 moderno): subida directa.
- **Placas sin auto-reset**: secuencia manual:
  1. Mantener **BOOT**
  2. Pulsar **EN/RST** una vez
  3. Soltar **BOOT**
  4. Ejecutar flash inmediatamente

### 5. Gestión de librerías (referencia)

```bash
arduino-cli lib search "ArduinoJson"
arduino-cli lib install "ArduinoJson"
arduino-cli lib install "ArduinoJson@6.21.3"      # versión fijada
arduino-cli lib install --git-url <url>.git        # revisar el repo antes
arduino-cli lib install --zip-path ./Lib.zip
```

Librerías comunes del ecosistema ESP32:

- **ACB_SmartCar_V2** — librería principal del Acebott QD001 (motores, sensores,
  servo). Incluida en el bundle ACECode.
- `ArduinoJson` — JSON parsing/serialization
- `PubSubClient` — MQTT
- `WiFiManager` — captive portal para configuración WiFi
- `DHT sensor library` + `Adafruit Unified Sensor` — sensores DHT
- `BMP280_DEV` — sensor de presión
- `TFT_eSPI`, `U8g2` — displays
- `ESPAsyncWebServer` + `AsyncTCP` — HTTP server asíncrono

### 6. Monitor serie (referencia)

```bash
# macOS (proyecto usa este puerto)
arduino-cli monitor -p /dev/cu.usbserial-110 --config baudrate=115200
# Alternativas: minicom -D /dev/cu.usbserial-110 -b 115200
#               picocom -b 115200 /dev/cu.usbserial-110
```

Baudrates típicos: 9600, 115200 (el más común), 230400.
El ESP32 arranca a 115200 para el bootloader.

### 7. APIs ESP32 Arduino (referencia de código)

```cpp
// PWM — API de Arduino-ESP32 3.x (cambió vs 2.x: ledcSetup quedó obsoleto)
ledcAttach(pin, freq_hz, resolution_bits);   // ej. ledcAttach(2, 5000, 8);
ledcWrite(pin, duty);                        // duty 0..(2^bits - 1)

// Touch capacitivo + DAC (GPIO25/26)
int v = touchRead(4);
dacWrite(25, 128);                           // 0..255

// NVS no volátil
#include <Preferences.h>
Preferences prefs;
prefs.begin("myapp", false);                 // false = lectura/escritura
prefs.putString("ssid", "value");
String s = prefs.getString("ssid", "default");
prefs.end();
```

### 8. Estructura de un sketch

- Un `.ino` principal con `setup()` y `loop()`.
- Múltiples `.ino`/`.cpp`/`.h` en la misma carpeta se compilan juntos.
- `src/` para módulos C++ auxiliares.
- `library.properties` para librerías distribuibles.
- El `.ino` debe estar en un directorio con el mismo nombre (`Foo/Foo.ino`).

## Gotchas / Trampas

- **`arduino-cli upload` fuerza 921600 baud** → causa `0xE0` en CH340. Usar
  esptool bundled @ 115200 (ver skill `acebott-esp32-flash`).
- **Upload con monitor serie abierto** → puede bloquear el puerto; cerrar el
  monitor antes de flashear.
- **Cores grandes (ESP32)** → la primera instalación pesa cientos de MB.
- **Versionado de librerías** → fijar con `@version` si depende de una API concreta.
- **`Failed to connect to ESP32: Timed out`** → no está en modo bootloader.
  Aplicar secuencia BOOT/EN manual.
- **`Failed to connect ... Invalid head of packet`** → puerto ocupado o baudrate
  incoherente. Cerrar monitores; bajar `UploadSpeed`.
- **`No board selected`** → falta `arduino-cli core install esp32:esp32` o FQBN
  mal escrito.
- **Library not found** → `arduino-cli lib install "<Name>"`.
- **Permisos de puerto** → en macOS el puerto es accesible por defecto
  (`/dev/cu.usbserial-*`). En Linux: agregar a grupo `dialout`.
- **Sketch demasiado grande** → usar `:PartitionScheme=huge_app` o `min_spiffs`.
- **API PWM cambió en 3.x** → `ledcSetup`/`ledcAttachPin` obsoletos, usar
  `ledcAttach(pin, freq, res)`.
- **`.ino` debe coincidir con el directorio** → `Foo/Foo.ino`, no `Foo/bar.ino`.
- **`while (!Serial)` innecesario en ESP32** — USB-Serial siempre listo.

## Fuentes / Sources

- https://github.com/EricSun787/esp32-arduino-development (SKILL.md original)
- https://arduino.github.io/arduino-cli/ (Arduino CLI docs)
- https://docs.espressif.com/projects/arduino-esp32/ (Arduino-ESP32 core)
