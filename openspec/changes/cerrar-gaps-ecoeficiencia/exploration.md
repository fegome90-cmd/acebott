# Exploration: cerrar-gaps-ecoeficiencia

> Cerrar los gaps de skills identificados en la auditoría de ecoeficiencia del
> robot QD001: skills faltantes (`esp32-ota`, `esp32-displays`, `esp32-ble`),
> sección **mTLS** dentro de `esp32-connectivity`, y utilería de calibración
> interactiva del line-follower con persistencia en NVS.

**Modo artifact store:** openspec
**Fecha:** 2026-07-03

> Nota de evolución: este documento es exploratorio. Los contratos vigentes están
> en `proposal.md`, `spec.md` y `design.md`. En particular, quedaron superseded:
> NimBLE como default, las keys `black_l`/`black_m`/`black_r`, la promesa de
> firmware firmado por usar HTTPS OTA, y TFT como alcance implementado.

---

## Current State

El repo tiene **11 skills curadas** (6 QD001 + 5 genéricas) bajo `skills/`,
indexadas en `skills/README.md`. El propio README (sección "Gaps restantes",
líneas 75-91) enumera EXPLÍCITAMENTE como gaps reales: OTA, OLED/NeoPixel/displays,
BLE/LoRa, mTLS/TLS mutuo. Es decir, el scope de este change ya está reconocido.

La skill `skills/esp32-connectivity/SKILL.md` **ya cubre TLS básico** (no mTLS):
- `WiFiClientSecure` con `setCACert(root_ca)` para MQTTS puerto 8883 (líneas 255-267)
- HTTPS con `WiFiClientSecure` (líneas 323-330)
- Aviso explícito de que `setInsecure()` es DEV-only y vulnera a MITM (línea 391-392)
- **mTLS ausente**: no hay `setCertificate()` ni `setPrivateKey()` (client cert mutual auth).

La skill `skills/qd001-sensors/SKILL.md` documenta el line-follower:
- Thresholds **hardcodeados**: `Black_Line = 2000`, `Off_Road = 4000` (líneas 177-182)
- Pins IR analógicos: Left=**35**, Middle=**36**, Right=**39** (líneas 164-170), leídos con `analogRead()`
- Procedimiento de calibración documentado (medir negro/blanco → midpoint), pero **sin persistencia**.

`.llm-wiki/wiki/concepts/line-tracking-sensor-calibration.md` confirma los valores
(`Black_Line = 2000` línea 8, `Off_Road = 4000` línea 40) y la fórmula midpoint.
`Preferences.h` (NVS) ya está documentada en `skills/esp32-arduino-development/SKILL.md`
(líneas 134-140) pero **no se usa** para persistir umbrales.

## Affected Areas

- `skills/README.md` — índice: añadir 3 skills nuevas (OTA, Displays, BLE) + actualizar la sección "Gaps restantes" (marcar OTA/Displays/BLE/mTLS como cubiertos).
- `skills/esp32-connectivity/SKILL.md` — añadir sección **mTLS** (cliente + servidor, `setCertificate`/`setPrivateKey`, `WiFiClientSecure` mutual auth).
- `skills/esp32-ota/` (NUEVO) — `SKILL.md` con OTA clásico + HTTPS OTA con validación de certificado del servidor. Firma de imagen queda fuera de alcance.
- `skills/esp32-displays/` (NUEVO) — `SKILL.md` cubriendo OLED (SSD1306), NeoPixel y GFX; TFT queda fuera de alcance implementado.
- `skills/esp32-ble/` (NUEVO) — `SKILL.md` con `BLEDevice` (Arduino-ESP32) vs `NimBLE`.
- `tools/calibration/` o `references/` (NUEVO, dentro de la skill o como utilería) — sketch `.ino` interactivo de calibración + doc de uso.
- `.llm-wiki/wiki/concepts/ACB_SmartCar_V2 Library.md` — **es un STUB**; no documenta los headers `ACB_Adafruit_*`. Ver Riesgo #1.

## Approaches

### Gap 1 — OTA

1. **ArduinoOTA (clásico, lib ArduinoOTA)**
   - Pros: 3 líneas para habilitar (`ArduinoOTA.begin/onLoop/handle`); sin infraestructura de servidor; ideal para dev/LAN; ya viene con el core Arduino-ESP32.
   - Cons: **sin firma** de firmware → cualquiera en la LAN puede flashear (acepta binarios arbitrarios); sin rollback automático; sin HTTP server personalizable.
   - Esfuerzo: Low (documentación pura, sketch ejemplo ~30 líneas).

2. **esp_https_ota (ESP-IDF / Arduino-ESP32) — producción**
   - Pros: OTA sobre HTTPS con **validación de certificado** del server; soporta HTTP/HTTPS server propio. Firma de imagen/Secure Boot requiere diseño aparte.
   - Cons: más complejo (particionado OTA, manejo de `esp_ota_*`, certificados CA embebidos); requiere servidor/hosting del binario.
   - Esfuerzo: Medium-High (sketch + particionado + doc de CA cert + flujo de rollback).

**Recomendación:** Documentar **AMBOS** en la skill `esp32-ota`, pero estructurados por audiencia: "Dev/LAN rápido → ArduinoOTA", "Producción/seguro → esp_https_ota". El robot QD001 se controla por WiFi AP, así que OTA LAN es el caso de uso natural; pero como es un dispositivo físico, conviene enseñar el path seguro. Mismo patrón pedagógico que usa `esp32-connectivity` (dev vs producción, como hace con `setInsecure()` vs `setCACert()`).

### Gap 2 — Displays (OLED/NeoPixel/GFX; TFT out of scope)

**Hallazgo crítico:** Los headers `ACB_Adafruit_SSD1306`, `ACB_Adafruit_NeoPixel`, `ACB_Adafruit_GFX` **NO están extraídos en el repo** (verificados con `rg` repo-wide: 0 hits). Solo existe `Español/.../ACB_SmartCar_V2.zip` (bundle precompilado opaco). El archivo `.llm-wiki/wiki/concepts/ACB_SmartCar_V2 Library.md` es un **STUB vacío**. Las skills `esp32-arduino-development/SKILL.md` solo name-dropean `TFT_eSPI` y `U8g2`.

1. **Documentar headers `ACB_*` precompilados (binario opaco)**
   - Pros: fiel al bundle que el robot realmente usa; las apps/sketches de Acebott importan `ACB_Adafruit_*`.
   - Cons: **no hay headers accesibles** para inspeccionar API → habría que extraer el `.zip` y leer los `.h`/`.a`; el equipo dice que son precompilados `.a` linkageados contra core 2.0.18 (no hay fuente editable); API a ciegas salvo que se extraiga el bundle.
   - Esfuerzo: Medium (requiere unzip + inspección de headers).

2. **Documentar libs Adafruit originales (`Adafruit_SSD1306`, `Adafruit_NeoPixel`, `Adafruit_GFX`) + nota del wrapper ACB_**
   - Pros: fuente editable, docs oficiales Adafruit extensas, ejemplos canónicos; la API pública del wrapper `ACB_*` es casi seguro un thin wrapper sobre estas (mismo `begin()`/`drawPixel()`/`show()`); no depende de extraer el zip opaco.
   - Cons: riesgo de divergencia si el wrapper `ACB_*` cambió firmas o renombró métodos; hay que advertir que "si tu sketch importa `ACB_Adafruit_SSD1306`, la API espeja la original salvo que Acebott la haya modificado".
   - Esfuerzo: Low-Medium.

**Recomendación:** **Approach híbrido** (2 como base + nota 1). Documentar la API estándar Adafruit (SSD1306 128x64 I2C, NeoPixel single-wire, GFX primitives) desde docs oficiales vía Context7 (`/adafruit/Adafruit_SSD1306`, `/adafruit/Adafruit_NeoPixel`), y añadir una **nota destacada**: "El robot QD001 incluye wrappers precompilados `ACB_Adafruit_*` (.a, core 2.0.18) que espejan esta API. Si tu sketch los importa, la firma pública coincide salvo modificación Acebott. **No subir a core 3.x** (rompe binary compat de los `.a`)." Esto evita el zip opaco pero queda alineado con el bundle real. TFT queda como tecnología relacionada, no como capacidad implementada por este change.

### Gap 3 — BLE

1. **`BLEDevice` (Arduino-ESP32, lib BLE)**
   - Pros: viene con el core Arduino-ESP32 (2.0.18 lo soporta); API documentada (`BLEDevice::init`, `BLEServer`, `BLEService`, `BLECharacteristic`); ejemplos abundantes.
   - Cons: ocupa **más RAM/flash** (~70-100 KB stack BLE); peor para batería; en cores 3.x el BLE classic quedó deprecado a favor de NimBLE.
   - Esfuerzo: Low-Medium.

2. **NimBLE (lib H2zero/NimBLE-Arduino)**
   - Pros: menor consumo de RAM/flash en muchos casos, ideal para escenarios con presión de memoria; compatible con la misma API conceptual.
   - Cons: lib **externa** (instalación vía Library Manager, no viene en el core); síntaxis ligeramente distinta a `BLEDevice`; para core 2.0.18 funciona pero hay que verificar versión compatible.
   - Esfuerzo: Medium (instalación + doc de migración conceptual).

**Recomendación superseded:** esta exploración propuso NimBLE como default, pero `proposal.md`/`spec.md`/`design.md` adoptaron `BLEDevice` nativo como baseline porque no requiere dependencia externa. NimBLE queda como alternativa opt-in con confirmación explícita.

### Gap 4 — mTLS (sección dentro de `esp32-connectivity`)

- **Approache único, sin alternativas reales** en Arduino-ESP32: `WiFiClientSecure` con **cliente cert + key** además del CA:
  - `client.setCACert(ca)` + `client.setCertificate(client_crt)` + `client.setPrivateKey(client_key)`.
- Para **server** (si el ESP hace HTTPS server): `WiFiServerSecure` con `setCertificate`/`setPrivateKey` (server-side mutual TLS requiere solicitar client cert).
- **Esfuerzo:** Low-Medium. Es una extensión natural de la sección TLS existente (líneas 255-267). Mismo formato: snippet + gotcha (generación de certs con openssl, tamaño del bundle, `PROGMEM` para CA).
- **Recomendación:** Añadir como sub-sección `### mTLS (mutual TLS)` debajo de la sección TLS actual, con gotcha: "mTLS requiere embeber CA + client cert + client key (~3-5 KB PROGMEM cada uno); generar con `openssl` en PC, no en el ESP."

### Gap 5 — Utilería de calibración interactiva del line-follower

- **Flujo:** sketch `.ino` que, por puerto serie, guía al usuario:
  1. "Colocá el sensor LEFT sobre línea NEGRA, mandá 'L'" → lee `analogRead(35)` N muestras → promedio.
  2. "...sobre BLANCO, mandá 'L'" → promedio blanco.
  3. Repite para MIDDLE (36) y RIGHT (39).
  4. Calcula `Black_Line_x = (black + white) / 2` por sensor.
  5. `Off_Road = 4000` (constante documentada, no recalibrada).
  6. Persiste con `Preferences.h`, namespace `"qd001"`, keys `line_l`/`line_m`/`line_r`/`off_road` y marcador final `line_cal_v=1`.
- **Carga en runtime:** el sketch del robot lee valores NVS solo si `line_cal_v == 1`; si no, usa defaults 2000/4000.
- **Esfuerzo:** Medium (sketch interactivo + doc de uso + snippet de carga desde el sketch principal).
- **Alternativa considerada y descartada:** auto-calibración en runtime (muestrear min/max durante movimiento). Descartada porque el line-follower está quieto al inicio y la calibración manual guiada es más confiable y auditable (coincide con `strict_tdd` del config: comportamiento verificable por serial monitor).

## Recommendation (consolidada)

Implementar los 5 gaps como **1 change, 5 deliverables**:

| Deliverable | Tipo | Approach | Esfuerzo |
|---|---|---|---|
| `skills/esp32-ota/` | Skill nueva | ArduinoOTA (dev) + esp_https_ota (prod) | Medium |
| `skills/esp32-displays/` | Skill nueva | API Adafruit original + nota wrapper `ACB_*` + advertencia core 3.x | Medium |
| `skills/esp32-ble/` | Skill nueva | BLEDevice default + NimBLE opt-in | Medium |
| Sección mTLS en `esp32-connectivity` | Edición skill existente | `WiFiClientSecure` mutual (CA+cert+key) | Low-Medium |
| Utilería calibración | Sketch `.ino` + doc | Flujo serie interactivo → `Preferences` namespace `qd001` | Medium |

Más actualización del índice `skills/README.md` (marcar gaps cubiertos, subir contador de skills).

**Convenciones a respetar** (de `openspec/config.yaml`):
- Skills curadas security-first (no auto-install libs externas sin confirmar — aplica a NimBLE y a displays Adafruit si se importan frescas).
- Firmware = gate de **hardware-validation** (compile → flash → serial monitor), no pytest. Los snippets son C++ Arduino, FQBN `esp32:esp32:esp32`.
- Documentar expected serial output (regla `design`).
- Toda skill nueva debe advertir: **no subir a Arduino core 3.x** (binary compat de los `.a` `ACB_*` + deprecación de `analogWrite()`).

## Risks

1. **CRÍTICO — Headers `ACB_*` inaccesibles:** los wrappers `ACB_Adafruit_SSD1306`/`NeoPixel` son precompilados (`.a`) dentro de `ACB_SmartCar_V2.zip` y el `.llm-wiki` NO los documenta (stub vacío). Documentar la skill `esp32-displays` desde la API Adafruit original es correcto pedagógicamente, pero **la fidelidad exacta del wrapper queda sin verificar** salvo que se extraiga el zip. **Mitigación:** nota explícita en la skill "API espeja la original salvo modificación Acebott; para inspección exacta, descomprimir `Español/.../ACB_SmartCar_V2.zip`." Dejar como tarea opcional de verify.

2. **NimBLE es lib externa** — viola la política "no auto-install" si se pide instalar ciegamente. **Mitigación:** documentar el comando de Library Manager pero **requerir confirmación explícita del usuario** antes (mismo patrón que el flash workflow).

3. **OTA productivo requiere particionado A/B** — cambiar el partition scheme del robot puede brickar si se hace mal. **Mitigación:** rollback plan obligatorio en el proposal (regla `proposal` del config); documentar `default` vs `min_spiffs` vs `partitions_custom`.

4. **mTLS infla PROGMEM** — 3 certs (CA + client + key) consumen flash; el robot ya corre WiFi+MQTT+motores. **Mitigación:** documentar tamaño aprox y flag de `setBuffer` si aplica.

5. **Calibración por serie asume USB conectado** — el robot en operación autónoma no tiene operador. **Mitigación:** documentar que la calibración es **setup-time**, y que el sketch principal cae al default 2000 si no hay valor persistido.

6. **BLE y WiFi comparten antena 2.4GHz** en ESP32 — no pueden transmitir simultáneamente en distintos canales. **Mitigación:** gotcha en la skill `esp32-ble`.

## Ready for Proposal

**Yes.** El scope está claro, los approaches están comparados con evidencia (citas del README, skills existentes, y `.llm-wiki`), y los riesgos están acotados con mitigaciones.

**Mensajes clave para el team-lead/orchestrator:**
- Los 5 gaps son **independientes** → el `tasks.md` puede paralelizarlos por skill.
- Confirmar con el usuario antes de: (a) instalar NimBLE, (b) extraer/inspeccionar el `ACB_SmartCar_V2.zip`, (c) cambiar partition scheme para OTA productivo.
- La skill `esp32-displays` depende de **confirmar si se quiere extraer el bundle** o aceptar el approach híbrido (recomendado). Sin esa decisión, la proposal puede avanzar pero el verify quedará condicional.
