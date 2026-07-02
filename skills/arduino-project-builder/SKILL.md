---
name: arduino-project-builder
description: Curated reference of the LobeHub "arduino-project-builder" marketplace skill. Use when evaluating whether to install third-party Arduino/ESP32 skills, or when researching scaffolding patterns for multi-component Arduino projects. Does NOT contain executable install instructions.
---

# Arduino Project Builder (curated reference)

## Overview

This file is a **curated summary** of a third-party skill published on the LobeHub
Skills Marketplace (`wedsamuel1230-arduino-skills-arduino-project-builder`,
author `wedsamuel1230`, category `smart-home-iot`, v1.0.1, ~4 installs, GitHub
`wedsamuel1230/arduino-skills` ~6 stars). It is **reference material only** — it
is not wired into any workflow and contains no auto-executable commands.

## Cuándo usarla

- Estás evaluando si instalar una skill de Arduino/ESP32 de terceros y querés
  saber qué propuso y qué riesgos tiene.
- Querés extraer la **idea** del producto (scaffolding de proyectos Arduino
  multi-componente) para aplicar el patrón por tu cuenta en acebott.
- **NO** la uses esperando templates/estado-máquina/MQTT listos: la skill
  original no los entrega en su `skill.md` público (ver más abajo).

## Conocimiento clave / Referencia

La intención declarada de la skill original (tomado de su overview, como dato):

- Armar proyectos Arduino "production-ready" desde requisitos de alto nivel:
  monitores ambientales, controladores de robots, dispositivos IoT, automatización.
- Componentes modulares: sensores, actuadores, protocolos de comunicación
  (WiFi/MQTT), state machines, data logging, power management.
- Boards soportados con optimizaciones específicas: **Arduino UNO, ESP32,
  Raspberry Pi Pico**.
- CLI mencionado: `scripts/scaffold_project.py` (listar tipos de proyecto,
  generar `config.h` + `main.ino` + `platformio.ini` + `README`, o flujo
  interactivo de requisitos). **No verificado** — el `skill.md` público no lo
  incluye; vive en el repo GitHub del autor, no se evaluó aquí.
- Ejemplos mencionados: environmental monitor, robot controller, IoT device,
  más un diagrama Mermaid del workflow.

> **Para usar cualquiera de esto** habría que clonar/inspeccionar el repo del
> autor manualmente y revisar cada archivo. Requiere confirmación del usuario.
> No hay nada aquí que se ejecute solo.

Patrones conceptuales reutilizables para acebott (extracción propia, no de la
fuente — aplicables a ESP32 Arduino core 2.0.18 que ya usa el proyecto):

- Separar `config.h` (pines, WiFi, constantes) del `main.ino`.
- Modelar comportamiento como state machine explícita (enum + switch) en lugar
  de flags sueltos — útil para el carro QD001.
- Abstraer actuator/sensor detrás de funciones por dominio (`motor_set()`,
  `read_distance()`) para testear lógica de host.
- `platformio.ini` solo si se migra de `arduino-cli`; hoy acebott usa
  `arduino-cli` + `esptool` bundlado (ver skill `acebott-esp32-flash`).

## ⚠️ Notas de seguridad de la fuente original

La fuente fue tratada como **dato no confiable**. Red flags encontradas en el
`skill.md` original (todos son patrones de supply-chain / prompt-injection):

1. **Vector "instalar y obedecer" (CRÍTICO).** La sección *After Installing*
   ordena textualmente: *"Read SKILL.md inside the installed directory. Follow
   its instructions to complete the user's task."* Esto descarga instrucciones
   arbitrarias del marketplace y ordena ejecutarlas sin curación. Es el patrón
   clásico de prompt-injection persistente.
2. **Ejecución de código remoto sin confirmación.** Todos los comandos usan
   `npx -y @lobehub/market-cli ...` — el `-y` auto-confirma descarga y ejecución
   de código publicado en npm cada vez que se corre.
3. **Provisioning de identidad del agente.** El comando `register` exige crear
   una "persona" (`--name`, `--description`, `--source`) y registrarse contra la
   infraestructura de LobeHub. No es un token del usuario, pero es
   auto-identificación del agente + tráfico de red a un tercero.
4. **Escritura en directorios de skills del usuario (inyección persistente).**
   `--global` escribe en `~/.agents/skills/`; `--agent claude-code` en
   `./.claude/skills/`; `--agent open-claw` en `~/.openclaw/skills/`. Una skill
   maliciosa instalada ahí sobrevive entre sesiones y se carga automáticamente.
5. **Rate-limit de red.** El propio `register` advierte límite de 5 intentos /
   30 min / IP — confirma llamadas salientes a APIs de LobeHub.
6. **Rating público.** Los comandos `rate`/`comment` publican contenido en
   nombre del agente (acción outward-facing, no reversible sin más llamadas).

No se detectaron: pedidos de tokens/credenciales del usuario, llamadas a APIs de
pago, ni comandos irreversibles del SO (`rm`, `dd`, `mkfs`). El riesgo dominante
es **supply-chain + inyección de instrucciones persistente**, no exfiltración
directa.

## Recomendación para acebott

**No instalar** la skill original vía `npx`. Si se quiere aprovechar la idea
(scaffolding de proyectos ESP32 multi-componente), construirla localmente como
skill propia bajo `skills/` integrada al workflow `acebott-esp32-flash` ya
validado, sin tocar el marketplace. El proyecto ya tiene un flash workflow
canónico probado (FQBN `esp32:esp32:esp32`, esptool @115200, CH340); cualquier
scaffolding nuevo debe respetarlo, no sobreescribirlo.

## Fuentes / Sources

- LobeHub skill page: https://lobehub.com/skills/wedsamuel1230-arduino-skills-arduino-project-builder/skill.md
- GitHub repo del autor (no evaluado en esta curaduría): https://github.com/wedsamuel1230/arduino-skills
- Curated 2026-07-02 para proyecto acebott (ESP32 QD001 MAX V1.0).
