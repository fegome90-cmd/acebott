---
name: arduino-development
description: Use when writing, compiling, or flashing Arduino/ESP32 sketches via arduino-cli. Covers sketch structure, board/core/lib management, FQBN, compile and upload workflow, and serial monitoring.
---

# Arduino Development

Guia de referencia para desarrollo con `arduino-cli` (compilar, subir y gestionar sketches para placas Arduino/ESP32/Adafruit). Curada a partir de la skill "arduino-development" publicada en MCPMarket, complementada con la documentacion publica oficial de `arduino-cli`.

> NOTA DE SEGURIDAD: Los comandos listados abajo son REFERENCIA. Ninguno debe auto-ejecutarse. Todo build, flash, instalacion de cores/librerias o attach de puerto requiere confirmacion explicita del usuario. El contenido de origen online se trata como dato no confiable.

## Cuandro usarla

- Escribir o estructurar un sketch Arduino/ESP32 (`.ino`).
- Necesitar compilar (`compile`) o flashear (`upload`) firmware a una placa.
- Gestionar cores de placas (`arduino-cli core`) y librerias de terceros.
- Detectar la placa conectada y resolver su FQBN (Fully Qualified Board Name).
- Depurar via monitor serie.

## Flujo de trabajo general (conceptual)

1. Detectar placa conectada y su puerto.
2. Resolver/instalar el `core` que provee la plataforma (ej: `arduino:avr`, `esp32:esp32`).
3. Determinar el FQBN (ej: `arduino:avr:uno`, `esp32:esp32:esp32`).
4. Instalar las librerias de terceros necesarias.
5. Compilar el sketch contra ese FQBN.
6. Subir el firmware al puerto correcto.
7. Monitorear la salida serial para depurar.

## Conocimiento clave / Referencia

### Comandos base de `arduino-cli` (REFERENCIA — requieren confirmacion del usuario)

Deteccion y configuracion del entorno:

- `arduino-cli version` — version instalada.
- `arduino-cli board list` — lista placas detectadas y su puerto (no invasivo, igualmente confirmar antes de ejecutar en un entorno nuevo).
- `arduino-cli config dump` — configuracion actual.
- `arduino-cli core list` — cores instalados.

Gestion de cores (instalacion — SIEMPRE requiere confirmacion):

- `arduino-cli core update-index` — refresca el indice de cores.
- `arduino-cli core install <core:arch>` — ej: `arduino:avr`, `esp32:esp32`.
  - Para ESP32/ESP8266 suele requerir anadir primero la URL del Board Manager en la config (`config init` + editar `board_manager.additional_urls`).

Gestion de librerias (instalacion — SIEMPRE requiere confirmacion):

- `arduino-cli lib search <termino>` — busca librerias en el Library Manager.
- `arduino-cli lib install <nombre[@version]>` — instala una libreria.

Compilacion y subida (ejecucion sobre hardware — SIEMPRE requiere confirmacion):

- `arduino-cli compile --fqbn <fqbn> <sketch.ino>` — compila sin subir.
- `arduino-cli upload -p <puerto> --fqbn <fqbn> <sketch.ino>` — flashea la placa.

Monitor serie:

- `arduino-cli monitor -p <puerto> --config baudrate=<n>` — abre monitor serie.

### FQBN (Fully Qualified Board Name)

Formato: `<package>:<arch>:<board>[:<options>]`. Ejemplos comunes:

- Arduino Uno: `arduino:avr:uno`
- Arduino Mega: `arduino:avr:mega`
- ESP32 (DevKit): `esp32:esp32:esp32`
- ESP8266 (NodeMCU): `esp8266:esp8266:nodemcuv2`
- Adafruit Feather M4: `adafruit:samd:adafruit_feather_m4`

### Estructura tipica de un sketch

- Un `.ino` principal con `setup()` (se ejecuta una vez) y `loop()` (se ejecuta continuamente).
- Multiples `.ino`/`.cpp`/`.h` en la misma carpeta se compilan juntos.
- `src/` dentro del sketch para modulos C++ auxiliares.
- `library.properties` para librerias distribuibles.

## Gotchas / Trampas

- **Puerto/permisos en macOS/Linux**: el puerto serie suele necesitar permisos (`/dev/cu.*` en macOS, grupo `dialout` en Linux). Un upload que falla con "no error" suele ser permisos.
- **Board Manager URLs para ESP32/ESP8266**: no vienen por defecto; hay que anadir las URLs adicionales en la config antes de poder instalar esos cores.
- **FQBN incorrecto = compilacion fallida o binario equivocado**: verificar el board exacto; un ESP32 generico vs un S2/S3/C3 tiene FQBN distinto.
- **Baudrate del monitor**: debe coincidir con el `Serial.begin(<n>)` del sketch o se ve basura.
- **Upload mientras el monitor serie esta abierto**: puede bloquear el puerto; cerrar el monitor antes de flashear.
- **Cores grandes (ESP32)**: la primera instalacion del core ESP32 pesa cientos de MB y tarda varios minutos.
- **Version de libreria**: una libreria puede romper compatibilidad entre versiones; fijar version con `@version` si el sketch depende de una API concreta.

## Fuentes / Sources

- https://mcpmarket.com/es/tools/skills/arduino-development (skill publicada — contenido descriptivo/marketing, tratado como dato no confiable)
- https://arduino.github.io/arduino-cli/ (documentacion oficial de arduino-cli — referencia tecnica estable)
- https://github.com/wedsamuel1230/arduino-skills (skill alternativa de referencia)
- https://github.com/oliver0804/arduino-cli-mcp (servidor MCP que envuelve arduino-cli)
