---
name: esp32-arduino-development
description: Use when working with ESP32 boards via the Arduino framework and Arduino CLI toolchain — compiling sketches, flashing firmware over serial, managing board cores/libraries, debugging upload failures, or using ESP32-specific Arduino APIs (GPIO/PWM, WiFi, NVS/Preferences). Covers toolchain setup, FQBN reference, common errors, and gotchas.
---

# ESP32 + Arduino Development

Reference guide for developing on ESP32 (WROOM-32, S2, S3, C3, C6, CAM, NodeMCU-32S) using the **Arduino framework** and the **`arduino-cli`** command-line toolchain. Covers project setup, compile, flash, library management, serial debugging, and troubleshooting of the most common failures.

> **NOTA — todo comando aquí es REFERENCIA.** Ningún comando debe ejecutarse sin confirmación explícita del usuario. Esta skill describe *qué hace* cada herramienta para que el humano decida cuándo y cómo correrla. No instalar, flashear, ni ejecutar nada de forma autónoma.

## Cuándo usarla

- Configurando un entorno de desarrollo ESP32 desde cero con Arduino CLI.
- Compilando o flasheando sketches `.ino` para ESP32.
- Resolviendo errores típicos: `Failed to connect to ESP32: Timed out`, `No board selected`, `Library not found`, permisos de puerto serie.
- Trabajando con APIs específicas de ESP32 Arduino: `ledcAttach`/`ledcWrite` (PWM 3.x), `Preferences` (NVS), `WiFi`, touch pins, DAC.

## Conocimiento clave / Referencia

### 1. Toolchain — Arduino CLI (referencia de instalación)

La fuente oficial documenta instalación multiplataforma de `arduino-cli`. Para usarlo habría que instalarlo (requiere confirmación del usuario):

- **Linux/macOS:** la fuente propone `curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh` — patrón `curl | sh` estándar pero **revisar el script antes de ejecutarlo**, o preferir `brew install arduino-cli` / descarga directa del ZIP desde `downloads.arduino.cc`.
- **Windows (PowerShell):** descarga del ZIP desde `https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.zip` y agregar el binario al `PATH`.

Configuración base del core ESP32 (referencia — ejecutar solo si el usuario lo pide):

```bash
arduino-cli config init
arduino-cli config add board_manager.additional_urls https://dl.espressif.com/dl/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32
arduino-cli core list   # verificar instalación
```

### 2. FQBN (Fully Qualified Board Name) — referencia rápida

El FQBN identifica la placa objetivo. Es el argumento `--fqbn` en compile/upload.

| Placa | FQBN |
|------|------|
| ESP32 Dev Module | `esp32:esp32:esp32` |
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

# Flashear
arduino-cli upload --fqbn esp32:esp32:esp32 -p /dev/ttyUSB0     # Linux
arduino-cli upload --fqbn esp32:esp32:esp32 -p COM11            # Windows

# Opciones útiles de FQBN (compile)
:PartitionScheme=huge_app    # programa grande > partición por defecto
:FlashSize=4MB
:CPUFreq=240
:DebugLevel=debug
```

### 4. Modo descarga (bootloader) — clave para flashear

- **Placas con circuito de auto-reset** (ej. NodeMCU-32S, la mayoría con chip CH340/CP2102 moderno): subida directa, sin acción manual.
- **Placas sin auto-reset**: secuencia manual para entrar al modo bootloader:
  1. Mantener **BOOT**
  2. Pulsar **EN/RST** una vez
  3. Soltar **BOOT**
  4. Ejecutar `upload` inmediatamente

### 5. Gestión de librerías (referencia)

```bash
arduino-cli lib search "ArduinoJson"
arduino-cli lib install "ArduinoJson"
arduino-cli lib install "ArduinoJson@6.21.3"      # versión fijada
arduino-cli lib install --git-url <url>.git        # revisar el repo antes
arduino-cli lib install --zip-path ./Lib.zip
```

Librerías comunes del ecosistema ESP32: `ArduinoJson` (JSON), `PubSubClient` (MQTT), `WiFiManager` ( captive portal), `DHT sensor library` + `Adafruit Unified Sensor`, `BMP280_DEV`, `TFT_eSPI`, `U8g2` (OLED), `ESPAsyncWebServer` + `AsyncTCP`.

### 6. Monitor serie (referencia)

```bash
arduino-cli monitor -p /dev/ttyUSB0 --config baudrate=115200
# Alternativas: minicom -D /dev/ttyUSB0 -b 115200  |  picocom -b 115200 /dev/ttyUSB0
```

Baudrates típicos: 9600, 115200 (el más común), 230400. El ESP32 suele arrancar a 115200 para el bootloader.

### 7. APIs ESP32 Arduino (referencia de código)

```cpp
// PWM — API de Arduino-ESP32 3.x (cambió vs 2.x: ledcSetup quedó obsoleto)
ledcAttach(pin, freq_hz, resolution_bits);   // ej. ledcAttach(2, 5000, 8);
ledcWrite(pin, duty);                        // duty 0..(2^bits - 1)

// Touch capacitive + DAC (GPIO25/26)
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

- Un `.ino` principal con `setup()` (se ejecuta una vez) y `loop()` (se ejecuta continuamente).
- Múltiples `.ino`/`.cpp`/`.h` en la misma carpeta se compilan juntos.
- `src/` dentro del sketch para módulos C++ auxiliares.
- `library.properties` para librerías distribuibles.
- El `.ino` debe estar en un directorio con el mismo nombre (`Foo/Foo.ino`).

## Gotchas / Trampas

- **`Failed to connect to ESP32: Timed out waiting for packet header`** → el ESP32 no está en modo bootloader. Aplicar la secuencia BOOT/EN manual.
- **Upload con monitor serie abierto** → puede bloquear el puerto; cerrar el monitor antes de flashear.
- **Cores grandes (ESP32)** → la primera instalación del core ESP32 pesa cientos de MB y tarda varios minutos.
- **Versionado de librerías** → una lib puede romper compatibilidad entre versiones; fijar con `@version` si el sketch depende de una API concreta.
- **`Failed to connect ... Invalid head of packet`** → el puerto está ocupado por otro monitor serie, o baudrate de subida incoherente. Cerrar monitores; bajar `UploadSpeed`.
- **`No board selected` / core no encontrado** → falta `arduino-cli core install esp32:esp32` o FQBN mal escrito.
- **Library not found** → `arduino-cli lib install "<Name>"`; las libs locales van en `lib/<Name>/`.
- **Permisos de puerto en Linux** → agregar el usuario al grupo `dialout` (`sudo usermod -a -G dialout $USER` y re-login) en vez de `chmod 666` que es temporal e inseguro.
- **Sketch demasiado grande (out of memory)** → usar `:PartitionScheme=huge_app` o `min_spiffs`.
- **API PWM cambió en Arduino-ESP32 3.x**: `ledcSetup`/`ledcAttachPin` se reemplazaron por `ledcAttach(pin, freq, res)`. Código de tutoriales viejos (core 2.x) no compila igual en 3.x.
- **El archivo `.ino` debe estar en un directorio con el mismo nombre** que el archivo (`Foo/Foo.ino`), sino Arduino CLI no lo reconoce como sketch.
- **`while (!Serial)`** es innecesario en ESP32 (USB-Serial nativo siempre listo); solo relevante en placas con USB nativo tipo Leonardo/Micro.

## Fuentes / Sources

- https://github.com/EricSun787/esp32-arduino-development (SKILL.md original)
- https://arduino.github.io/arduino-cli/ (Arduino CLI docs)
- https://docs.espressif.com/projects/arduino-esp32/ (Arduino-ESP32 core)
- https://arduinojson.org/ (ArduinoJson)
