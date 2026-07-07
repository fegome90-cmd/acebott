# Proposal: cerrar-gaps-ecoeficiencia

> Modo artifact store: **openspec**. Deriva de `exploration.md` (mismo change).
> Fuente: `skills/README.md` (gaps 75-91), `skills/esp32-connectivity/SKILL.md`,
> `skills/qd001-sensors/SKILL.md`, `.llm-wiki/.../line-tracking-sensor-calibration.md`.

## Intent

Cerrar los gaps principales de skills explícitamente reconocidos en la auditoría
de ecoeficiencia del QD001 (`README.md` "Gaps restantes": OTA, Displays, BLE,
mTLS) y agregar utilería de calibración persistente para el line-follower
(umbrales hoy hardcodeados `Black_Line=2000`/`Off_Road=4000`, sin NVS).

Nota de alcance: `README.md` también menciona **ULP coprocessor** como gap real,
pero queda fuera de este change por ser una capacidad low-power avanzada, no
necesaria para cerrar los gaps operativos inmediatos del QD001.

## Scope

### In Scope (5 deliverables + README index update)
- **`skills/esp32-ota/`** (NUEVO): ArduinoOTA (dev/LAN) + HTTPS OTA con validación del certificado del servidor y rollback A/B condicionado a soporte efectivo del bootloader.
- **`skills/esp32-displays/`** (NUEVO): API Adafruit original (`Adafruit_SSD1306`/`NeoPixel`/`GFX`) + nota wrapper `ACB_*` + advertencia core 3.x.
- **`skills/esp32-ble/`** (NUEVO): `BLEDevice` nativo (default) + tabla comparativa NimBLE (alternativa).
- **Sección mTLS** en `skills/esp32-connectivity/SKILL.md`: `setCertificate`/`setPrivateKey` (CA+cert+key).
- **Utilería calibración**: sketch `.ino` interactivo por serie → `Preferences` namespace `qd001`.
- **README index update**: `skills/README.md` +3 skills, marcar OTA/Displays/BLE/mTLS como cubiertos, y dejar ULP como gap explícito restante.

### Out of Scope
- Extraer/inspeccionar `ACB_SmartCar_V2.zip` (decisión diferida — ver Risks).
- Auto-calibración runtime (descartada en exploration: no auditable).
- LoRa, OTA por BLE.
- ULP coprocessor / ultra-low-power firmware flows.

## Approach

1 change, 5 deliverables **independientes** (paralelizables en `tasks.md`).
Mismo patrón pedagógico que `esp32-connectivity` (dev vs prod). Firmware gates:
todos los ejemplos deben compilar; la calibración requiere compile→flash→serial
+ persistencia tras reset; OTA productivo no puede reclamar validación funcional
en este change.

### Decisiones adoptadas

| # | Decisión | DEFAULT aplicado | Alternativa (requiere confirmación) |
|---|----------|------------------|--------------------------------------|
| D1 | Displays `ACB_*` | Skill basada en **API Adafruit original** + nota "wrapper `ACB_*` espeja la API salvo modificación Acebott". **NO extraer el `.zip`**. | Extraer `ACB_SmartCar_V2.zip` e inspeccionar `.h` (costo: Medium, fideldiad exacta). |
| D2 | BLE lib | **`BLEDevice` nativo** Arduino-ESP32 (sin instalar nada). Este proposal corrige la recomendación inicial de `exploration.md` porque NimBLE, aunque eficiente, introduce dependencia externa y requiere confirmación explícita. | **NimBLE** (H2zero) — menor RAM/flash en muchos casos, pero lib externa: confirmar antes de instalar. |
| D3 | OTA productivo | **Rollback plan obligatorio condicionado a verificación** dentro de `esp32-ota`: particiones `ota_0`/`ota_1` + `otadata` son necesarias pero no suficientes; se debe verificar soporte real de rollback en el bootloader antes de prometer rollback automático. | Secure Boot, anti-rollback por versión y firma de imagen quedan fuera de alcance. |

## Affected Areas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `skills/esp32-ota/` | New | Skill OTA dual (dev/prod) |
| `skills/esp32-displays/` | New | Skill OLED/NeoPixel/GFX |
| `skills/esp32-ble/` | New | Skill BLE |
| `skills/esp32-connectivity/SKILL.md` | Modified | + sección mTLS (sub-sección TLS actual) |
| `skills/qd001-sensors/` (o `tools/`) | New | Sketch calibración `.ino` + doc |
| `skills/README.md` | Modified | Índice +3, gaps cubiertos |

## Risks

| Riesgo | Prob | Mitigación |
|--------|------|-----------|
| `ACB_*` inaccesibles (D1) | Med | Nota "API espeja original"; inspección zip = tarea opcional de verify |
| NimBLE lib externa (D2) | Med | Default `BLEDevice` nativo; NimBLE solo con confirmación explícita |
| OTA A/B brickea (D3) | Med | Rollback plan obligatorio condicionado; documentar partition schemes, self-test, verificación de bootloader, y recuperación por USB/esptool |
| mTLS infla flash/heap | Low | Documentar costo de CA/cert/key sin prometer cifras fijas; usar placeholders y evitar claves reales en repo |
| Calibración inválida o parcial | Med | Rechazar bajo contraste, escribir todo al final, usar `line_cal_v=1` como marcador de completitud y defaults 2000/4000 si falta |
| Calibración asume USB | Low | Setup-time; sketch principal cae a default 2000/4000 si no hay calibración completa |
| BLE+WiFi antena 2.4GHz | Low | Gotcha: no transmiten canales distintos simultáneos |

## Rollback Plan

- **Skills/docs**: son aditivos (3 nuevas + 2 edits). Revert = `git revert` del
  commit del change; sin impacto en firmware flasheado.
- **OTA particionado A/B (D3, crítico)**: antes de cambiar partition scheme,
  respaldar el sketch funcional actual + partition table vigente. OTA productivo
  MUST usar `ota_0`/`ota_1` + `otadata`, pero eso no basta para rollback
  automático: antes de prometer rollback se debe verificar que el bootloader
  flasheado soporta app rollback. Secure Boot, anti-rollback por versión y firma
  de imagen quedan fuera de alcance. Si el flash falla o boot loop → re-flashear
  último binario conocido vía USB (esptool @115200). **No reclamar rollback A/B
  automático sin soporte de bootloader demostrado.**
- **Calibración NVS**: eliminar solo las claves de line-follower con
  `prefs.remove("line_l")`, `prefs.remove("line_m")`, `prefs.remove("line_r")`,
  `prefs.remove("off_road")` y `prefs.remove("line_cal_v")`; no usar
  `prefs.clear()` porque vacía todo el namespace `qd001`.

## Dependencies

- Arduino-ESP32 core 2.0.18 (no 3.x — binary compat `.a` + `analogWrite` deprecado).
- `Adafruit_SSD1306`/`NeoPixel`/`GFX` (vía Library Manager, si sketch no usa wrapper `ACB_*`).
- NimBLE (H2zero) — **solo si D2 se resuelve a favor** (requiere confirmación).

## Success Criteria

- [ ] Preflight registra toolchain, librerías instaladas y capacidad real de rollback del bootloader; si faltan librerías externas, esos targets se detienen y piden autorización.
- [ ] 3 skills nuevas (`esp32-ota`, `esp32-displays`, `esp32-ble`) compilan sus snippets cuando sus dependencias ya están disponibles (FQBN `esp32:esp32:esp32`).
- [ ] `esp32-connectivity` tiene sección mTLS con snippet CA+cert+key funcional.
- [ ] Sketch calibración flashea, rechaza contraste insuficiente, persiste umbrales en NVS solo como commit completo (`line_cal_v=1`) y es verificable por serial.
- [ ] Cada skill nueva incluye al menos un sketch/snippet mínimo verificable con `arduino-cli compile --fqbn esp32:esp32:esp32`.
- [ ] `README.md` marca OTA/Displays/BLE/mTLS como cubiertos; contador skills = 14; ULP permanece documentado como gap fuera de alcance.
- [ ] Toda skill nueva advierte "no subir a core 3.x".
