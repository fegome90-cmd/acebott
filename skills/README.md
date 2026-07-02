# Skills curadas — acebott (ESP32)

> Set de skills curadas para **abrir el desarrollo ESP32/Arduino en acebott**.
> Habilita el stack completo de desarrollo de firmware: toolchain, periféricos
> de bajo nivel, conectividad, storage, RTOS, y las reglas de ingeniería
> embebida que hacen que ese código sea robusto.
>
> El catálogo de funciones Acebott **ya existe** como las librerías `ACB_*`
> dentro del bundle ACECode (ver "Dónde está el firmware / librerías Acebott").
> Este set de skills ayuda a **trabajar con esas librerías y a ir más allá**.
>
> Hardware: **Acebott QD001 ESP32 MAX V1.0**, ESP32-D0WD-V3, Arduino core 2.0.18,
> driver USB-serial **CH340/CH341** (NO CP210x), puerto `/dev/cu.usbserial-*`.

## Dónde está el firmware / librerías Acebott

El firmware fuente editable de acebott **NO** son sketches `.ino` sueltos en el
repo. Vive dentro del bundle ACECode (app instalada en el sistema):

- **Librerías editables `ACB_*`** —
  `/Applications/ACECode.app/Contents/extraFiles-mac/compile/keep/`
  Son **72 librerías Acebott** (`ACB_Buzzer`, `ACB_CAR_MOTOR`, `ACB_ColorSensor`,
  `ACB_130Motor`, `ACB_Biped_Robot`, `ACB_Adafruit_SSD1306` OLED,
  `ACB_Adafruit_NeoPixel`, etc.) + 10 dependencias de terceros (Adafruit_BMP280,
  Adafruit_BusIO, Adafruit_TCS34725, ArduinoJson, U8g2, NTPClient,
  PS3_Controller_Host, Time, …). Cada una con `library.properties` + `src/`.
  **Son precompiladas** (`precompiled=true`): headers `.h` + `.a` estático para
  ESP32, **sin `.cpp` fuente** (salvo `ACB_Adafruit_SSD1306` que trae formato
  ESP-IDF). `library.properties` declara `architectures=esp32`.
- **Ejemplos `.ino`** — en `compile/sketch/` (107 entradas) y
  `compile/sample-program/` (variantes QD/QE/AI), **no** dentro de las libs.
- **Binarios firmware precompilados** — `compile/burner/`:
  `QDpython-firmware.bin`, `QEpython-firmware.bin`, `python-firmware.bin`,
  `esp32-cam-firmware.bin`, `esp8266_firmware_python.bin`, `k210.kfpkg`,
  `FontLibrary.bin`, y subcarpetas `app/`, `oled/`, `esp32/` (partitions +
  bootloader + firmware = imagen completa de placa).
- **Toolchain bundlado** — `compile/arduino-cli` (x64) + `compile/burner/esptool`
  (también en toolchains esp32 v4.5.1 y esp8266 v0.4.13) + `kflash` (K210) +
  `rshell` (MicroPython). Orquestadores JS (electron): `build.js`, `burner.js`,
  `upload.js`, `uploadPython.js` invocan `arduino-cli`+`esptool` como subprocess.
  **NO** hay PlatformIO ni ESP-IDF directo.

**Para desarrollar con las `ACB_*`**: copiar las carpetas a `~/Arduino/libraries/`
y compilar con `arduino-cli compile -b esp32:esp32:<board>` (requiere
confirmación del usuario — ver advertencia de seguridad).

> Nota: `ACECode Setup-Mac-x86/` en el repo solo contiene el instalador
> (`ACECode-2.2.1.dmg`) y un PDF tutorial. La app instalada (con las libs) vive
> en `/Applications/ACECode.app/`.

## Qué habilita este set

Estas skills abren el desarrollo amplio ESP32/Arduino para acebott. La cobertura
real (mapeada leyendo cada skill) incluye:

- **Toolchain `arduino-cli`**: instalación, board manager, cores, FQBN, compile,
  upload, monitor serie, gestión de librerías.
- **Periféricos de bajo nivel ESP32**: PWM (`ledcAttach`/`ledcWrite`), DAC,
  touch capacitivo, NVS/Preferences (storage no volátil).
- **Conectividad y red** (vía librerías referenciadas): WiFi, MQTT
  (`PubSubClient`), HTTP async server (`ESPAsyncWebServer`), WiFiManager.
- **Librerías comunes ya catalogadas**: ArduinoJson, DHT, BMP280_DEV, TFT_eSPI,
  U8g2 (displays), AsyncTCP.
- **Ingeniería embebida**: reglas MUST DO / MUST NOT DO para ISRs (`volatile`,
  handlers cortos, secciones críticas), watchdog, concurrencia FreeRTOS
  (mutexes/semáforos/queues), workflow colaborativo IA↔humano.
- **Estructura de proyectos**: separación `config.h`/`main.ino`, state machines
  explícitas, abstracción por dominio (`motor_set()`, `read_distance()`).

## ⚠️ Seguridad — LEER ANTES DE USAR

- Estas skills fueron **curadas**: el contenido online se trató como **dato no
  confiable**, se hizo security review, y todo imperativo ejecutable
  (`compile`, `upload`, `core install`, `npx ...`) se neutralizó a
  *"requiere confirmación explícita del usuario"*.
- **NO instalar skills de marketplaces** (LobeHub, MCPMarket, etc.) vía
  `npx -y`. El patrón *"instalá la skill y seguí sus instrucciones"* es un
  vector de **prompt-injection / supply-chain** — inyección persistente en
  `~/.claude/skills/` que sobrevive entre sesiones y se carga automáticamente.
  Ver los 6 red flags documentados en
  [`arduino-project-builder/SKILL.md`](arduino-project-builder/SKILL.md).
- Antes de ejecutar **cualquier** comando de build/flash/upload/core-install:
  **confirmar con el usuario**.

## Cómo usarlas (por capacidad de desarrollo)

| Si vas a trabajar en… | Empezá por |
|---|---|
| Setup del toolchain, FQBN, compile/upload, errores de upload | [`esp32-arduino-development`](esp32-arduino-development/) |
| PWM (`ledcAttach`/`ledcWrite`), DAC, touch capacitivo | [`esp32-arduino-development`](esp32-arduino-development/) |
| NVS / Preferences (guardar config/calibración) | [`esp32-arduino-development`](esp32-arduino-development/) |
| WiFi / MQTT / HTTP server (selección de librerías) | [`esp32-arduino-development`](esp32-arduino-development/) — libs catalogadas |
| Estructura de un sketch multi-archivo (`src/`, `.cpp/.h`) | [`arduino-development`](arduino-development/) |
| Flujo genérico multi-placa (Uno/Mega/ESP8266/Feather) | [`arduino-development`](arduino-development/) |
| Reglas ISR / concurrencia / RTOS / robustez embebida | [`embedded-systems-engineering`](embedded-systems-engineering/) — leer **antes** de codear drivers/timing |
| Estructurar un proyecto ESP32 (config.h, state machines) | [`arduino-project-builder`](arduino-project-builder/) — leer primero su sección de seguridad |
| Inspiración sobre IA generando código Arduino | [`arduino-community-notes`](arduino-community-notes/) — solo inspiración |

> **Sobre flash/upload**: el workflow de flashear el robot ya está validado y
> vive en la skill `acebott-esp32-flash`
> (`/Users/felipe_gonzalez/.pi/agent/skills/acebott-esp32-flash/` — **user-level,
> NO copiada en este `skills/`**; el proyecto la referencia vía `AGENTS.md`).
> Diagnostica `Invalid head of packet (0xE0)` y flashea manual con esptool
> (FQBN `esp32:esp32:esp32`, @115200, CH340) cuando la UI ACECode falla.
> **Estas skills son para DESARROLLAR el firmware y sus funciones** — una vez
> que tenés el `.ino` o binario, usá `acebott-esp32-flash` para subirlo al
> hardware.

## Funciones por cubrir / expansión futura (gaps honestos)

> **Importante**: muchas funciones que las **skills genéricas** no cubren en
> profundidad **ya existen como librerías `ACB_*`** en el bundle (motores,
> servos, color sensor, NeoPixel, OLED SSD1306, buzzer, biped robot, etc. — ver
> "Dónde está el firmware / librerías Acebott"). Para esas, el camino es usar la
> `ACB_*` correspondiente, no escribir la API desde cero. Los gaps de abajo son
> lo que **ni** las skills genéricas **ni** las `ACB_*` documentan como skill
> navegable.

Tras mapear las skills, estas funciones ESP32/Arduino **NO** están cubiertas con
detalle utilizable como skill propia. Son áreas donde conviene agregar skills o
documentación específica:

**Control del robot QD001** (las `ACB_*` tienen los componentes, pero falta una
skill que orqueste el caso de uso completo):
- **Control del robot por app/web** (mencionado como caso de uso en
  `embedded-systems-engineering`, pero sin detalle) — gap crítico de orquestación.
- Mapeo de pines/placa del QD001 (qué `ACB_*` usar para cada actuador/sensor del
  carro) — gap de catálogo navegable.

**Otras funciones ESP32 no cubiertas**:
- WiFi/BLE/MQTT/HTTP con **código real** (hoy solo se listan las librerías en
  las skills genéricas).
- OTA (actualización over-the-air).
- Filesystem (SPIFFS / LittleFS) y SD card.
- Deep sleep / light sleep / power management.
- Timers hardware (hw_timer / GPTimer).
- `attachInterrupt` / ISRs con API concreta (solo principios en
  `embedded-systems-engineering`).
- FreeRTOS con API concreta (`xTaskCreate`, `xTaskCreatePinnedToCore`, colas) —
  solo principios hoy.
- I2C / SPI con código directo (`Wire.h`/`SPI.h`) — hoy solo vía librerías.
- ADC (`analogRead`, atenuación), IMU (MPU6050), displays OLED/TFT con código.

> Si vas a trabajar en cualquiera de estas, considerá construir una skill propia
> bajo `skills/` (no instalar de marketplace — ver advertencia de seguridad).

## Categorías de función que las `ACB_*` ya aportan (no son gap)

Para que conste — las librerías `ACB_*` del bundle ya cubren (a nivel binario +
header, precompiladas para ESP32) categorías que las skills genéricas tratan solo
de pasada o no tratan:

- **Motores**: `ACB_CAR_MOTOR`, `ACB_130Motor`, `ACB_Servo_esp8266`.
- **Robots completos**: `ACB_Biped_Robot`, `ACB_Spider_ESP8266`.
- **Sensores**: `ACB_ColorSensor`, más dependencias Adafruit (BMP280, TCS34725,
  Unified_Sensor) y `i2c_adc_ads7828`.
- **Displays / LEDs**: `ACB_Adafruit_SSD1306` (OLED), `ACB_Adafruit_NeoPixel`,
  más `U8g2` y `FontLibrary.bin`.
- **Audio**: `ACB_Buzzer`.
- **Conectividad/control**: `PS3_Controller_Host` (mando PS3), `ACB_WIFI`,
  `ACB_IRremote`, `NTPClient`, `Time`, `ArduinoJson`.

> Caveat: las `ACB_*` son **precompiladas** (`.a` + headers, sin fuente `.cpp`),
> con `library.properties` template genérico. Para modificar su comportamiento a
> nivel de código fuente hay que conseguir las fuentes por fuera del bundle.

## Notas del proyecto

- El firmware fuente vive en el bundle ACECode instalado (72 libs `ACB_*`
  precompiladas + ejemplos en `compile/sketch/` + binarios en `compile/burner/`).
  Ver detalle en "Dónde está el firmware / librerías Acebott".
- `ACECode Setup-Mac-x86/` en el repo solo tiene el instalador `.dmg` + PDF —
  **no** las libs. Las libs están en `/Applications/ACECode.app/`.
- Hardware confirmado vía `AGENTS.md`: Acebott QD001 ESP32 MAX V1.0,
  ESP32-D0WD-V3, Arduino core 2.0.18, CH340/CH341 (corregido 2026-07-01 — la
  memoria previa que decía CP210x era **errónea**).
- `esp32-arduino-development` es la skill más densa para ESP32 (APIs de bajo
  nivel + toolchain). `arduino-development` es intro genérica multi-placa. Hay
  solape en toolchain; cargá la primera para trabajo ESP32-específico.

## Fuentes originales

- `esp32-arduino-development` — https://github.com/EricSun787/esp32-arduino-development
- `arduino-development` — https://mcpmarket.com/es/tools/skills/arduino-development
- `arduino-project-builder` — https://lobehub.com/skills/wedsamuel1230-arduino-skills-arduino-project-builder/skill.md
- `embedded-systems-engineering` — https://snyk.io/es/articles/claude-skills-embedded-systems-engineers/
- `arduino-community-notes` — https://forum.arduino.cc/t/a-i-claude-to-write-code/1435577
