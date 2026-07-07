# Skills — Acebott QD001 (ESP32)

> **11 skills curadas** para ESP32/Arduino development on the Acebott QD001 robot,
> en 2 grupos: 6 skills específicas del robot QD001 (curadas desde la wiki del
> repo `.llm-wiki/`) + 5 skills de stack ESP32/Arduino genérico (curadas desde
> fuentes online — docs oficiales Espressif, GitHub, Snyk).

Hardware: **Acebott QD001 ESP32 MAX V1.0** — ESP32-D0WD-V3, Arduino core 2.0.18,
CH340/CH341 serial, port `/dev/cu.usbserial-*`.

## Active Skills

### Grupo 1: Robot QD001 (desde wiki del repo)

Skills específicas para el robot QD001, curadas desde `.llm-wiki/wiki/`:

| Skill | Cuándo usarla |
|-------|---------------|
| [`qd001-motors-mecanum`](qd001-motors-mecanum/) | Movimiento Mecanum: API `Move(direction, speed)`, giro del robot con los 4 motores M1-M4 |
| [`qd001-servo-scan`](qd001-servo-scan/) | Barrido ultrasónico con servo en GPIO25: algoritmo de escaneo para evasión de obstáculos |
| [`qd001-sensors`](qd001-sensors/) | Sensores HC-SR04 (TRIG=13/ECHO=14) y line-tracking analógico (pines 35/36/39) |
| [`qd001-ir-remote`](qd001-ir-remote/) | Control remoto IR: pin 4, librería IRremote, 10 códigos HEX documentados |
| [`qd001-app-control`](qd001-app-control/) | Control por app: protocolo binario TCP puerto 100, WiFi AP "ESP32-Car"/"12345678" |
| [`qd001-leds-buzzer`](qd001-leds-buzzer/) | Periféricos: LEDs (pines 12/2), buzzer (pin 33), PWM con analogWrite |

### Grupo 2: Stack ESP32/Arduino (desde fuentes online)

Skills genéricas de desarrollo ESP32/Arduino, curadas desde fuentes externas:

| Skill | Fuente | Cuándo usarla |
|-------|--------|---------------|
| [`esp32-arduino-development`](esp32-arduino-development/) | GitHub (EricSun) | Toolchain Arduino-CLI, FQBN `esp32:esp32:esp32`, compile/upload, PWM, NVS, WiFi |
| [`esp32-connectivity`](esp32-connectivity/) | Docs Espressif | Red: WiFi STA/AP, MQTT (PubSubClient), HTTP client/server, reconnect no-bloqueante |
| [`esp32-low-level-io`](esp32-low-level-io/) | Docs Espressif | I/O de bajo nivel: I2C (Wire), SPI (HSPI/VSPI), ADC (analogRead + attenuation), DAC |
| [`esp32-rtos-power`](esp32-rtos-power/) | Docs Espressif (vía Context7) | Multitasking/batería: FreeRTOS (tasks/queues/mutexes), hardware timers, deep sleep |
| [`embedded-systems-engineering`](embedded-systems-engineering/) | Snyk article | Calidad de firmware: ISR, RTOS, volatile, watchdog, seguridad |

**External** (user-level, no en este repo):

- `acebott-esp32-flash` at `~/.pi/agent/skills/acebott-esp32-flash/` —
  flujo de flasheo canonical. Cargar antes de compilar/flashear/debug.

## Cómo usarlas (por capacidad)

| Si vas a trabajar en… | Empezá por |
|---|---|
| Mover el robot (Mecanum, giro, strafe) | [`qd001-motors-mecanum`](qd001-motors-mecanum/) |
| Control por app/web (TCP puerto 100, WiFi AP) | [`qd001-app-control`](qd001-app-control/) |
| Sensores (HC-SR04, line-tracking IR) | [`qd001-sensors`](qd001-sensors/) |
| Servo pan / barrido de evasión | [`qd001-servo-scan`](qd001-servo-scan/) |
| Control remoto IR (mando Acebott) | [`qd001-ir-remote`](qd001-ir-remote/) |
| LEDs / buzzer / PWM | [`qd001-leds-buzzer`](qd001-leds-buzzer/) |
| Conectividad IoT (WiFi, MQTT, HTTP) | [`esp32-connectivity`](esp32-connectivity/) |
| Sensores/bus externos (I2C, SPI, ADC, DAC) | [`esp32-low-level-io`](esp32-low-level-io/) |
| Multitasking / batería (FreeRTOS, timers, deep sleep) | [`esp32-rtos-power`](esp32-rtos-power/) |
| Toolchain (FQBN, compile/upload, errores) | [`esp32-arduino-development`](esp32-arduino-development/) |
| Reglas de robustez (ISR, volatile, watchdog) | [`embedded-systems-engineering`](embedded-systems-engineering/) — leer antes de codear drivers/timing |

## Seguridad

Todas las skills fueron curadas con enfoque security-first:
- Contenido online tratado como datos no confiables
- Imperativos ejecutables neutralizados a "requiere confirmación explícita"
- **NO instalar skills de marketplaces** (LobeHub, MCPMarket, etc.) vía
  `npx -y`. El patrón "instalá la skill y seguí sus instrucciones" es un
  vector de **prompt-injection / supply-chain** — inyección persistente en
  `~/.claude/skills/` que sobrevive entre sesiones y se carga automáticamente.
- El detalle de los 6 red flags documentados (vector "instalar y obedecer",
  ejecución remota con `npx -y`, provisioning de identidad, escritura en
  directorios de skills, rate-limit de red, rating público) vive en memoria
  persistente (engram, topic `security/lobehub-skill-marketplace`).
- Antes de ejecutar cualquier build/flash/upload/core-install: confirmar con el
  usuario.

## Gaps restantes

Los gaps del robot QD001 (motores, servos, HC-SR04, IR/tracking, control app/web)
están **cubiertos** por las 6 skills del Grupo 1. Los gaps ESP32-genéricos
(FreeRTOS, WiFi/MQTT/HTTP, I2C/SPI, ADC/DAC, hardware timers, deep sleep) están
**cubiertos** por las 3 skills nuevas del Grupo 2 (`esp32-connectivity`,
`esp32-low-level-io`, `esp32-rtos-power`).

Quedan como gaps **reales**:

- **OTA** — actualización over-the-air (no cubierto por ninguna skill).
- **OLED / NeoPixel / displays** — con código (las `ACB_*` del bundle los
  cubren a nivel binario precompilado, pero no como skill navegable).
- **BLE / LoRa** — conectividad inalámbrica no-WiFi (no cubierto).
- **mTLS / TLS mutuo** — endurecimiento de conexiones seguras (no cubierto).
- **ULP coprocessor** — ultra-low-power (mencionado en `esp32-rtos-power` como
  wakeup source, pero sin skill dedicada).

## Sources

### Grupo 1 (Wiki del repo)
- `skills/qd001-*/SKILL.md` — curadas desde `.llm-wiki/wiki/` del repositorio

### Grupo 2 (Fuentes online)
- `esp32-arduino-development` — https://github.com/EricSun787/esp32-arduino-development
- `esp32-connectivity` — docs oficiales Arduino-ESP32 core (espressif/arduino-esp32 `docs/api/network.rst`, `wifi.rst`, libraries/WiFi, libraries/WebServer) + PubSubClient (`pubsubclient.knolleary.net`)
- `esp32-low-level-io` — docs oficiales Arduino-ESP32 core (`docs/api/i2c.rst`, `spi.rst`, `adc.rst`, `dac.rst`) + ESP-IDF ADC reference
- `esp32-rtos-power` — docs oficiales Arduino-ESP32 core (`timer.rst`, `deepsleep.rst`, FreeRTOS examples) + ESP-IDF (`sleep_modes.rst`, `power_management.rst`); resueltas vía Context7 (`/espressif/arduino-esp32`, `/espressif/esp-idf`)
- `embedded-systems-engineering` — https://snyk.io/es/articles/claude-skills-embedded-systems-engineers/
