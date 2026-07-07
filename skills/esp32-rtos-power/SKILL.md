---
name: esp32-rtos-power
description: Use when writing acebott (or any ESP32) firmware that needs FreeRTOS multitasking (xTaskCreate, queues, mutexes, semaphores), hardware timers (hw_timer_t / timerBegin), or low-power deep sleep (esp_deep_sleep_start, wakeup by GPIO/timer/ext0/ext1/ULP). Cites official Espressif + Arduino-ESP32 core docs. Reference only — confirm before flashing.
---

# ESP32 RTOS & Power (FreeRTOS / Timers / Deep Sleep)

Skill ESP32-genérica (no atada al robot acebott). Cubre los tres pilares de firmware embebido que aparecen una y otra vez:
concurrencia (FreeRTOS), timing por hardware (timers), y bajo consumo (deep sleep).

> **Fuente**: toda la API y los snippets están curados desde documentación oficial de Espressif (ESP-IDF) y del
> Arduino-ESP32 core. Ver `## Fuentes` al final. **No ejecutar/flashar ciegamente** — los comandos acá son de
> **referencia**: confirmar pines, frecuencias y lógica de wakeup contra el hw concreto antes de aplicar.

---

## Cuándo usarla

- Necesitás correr dos cosas "en paralelo" (ej: leer sensores sin bloquear el loop de motores) → FreeRTOS tasks.
- Compartís una variable o un recurso (Serial, I2C, una estructura global) entre tasks → mutex / semaphore.
- Necesitás un callback periódico preciso que NO use `delay()` (que bloquea) → hardware timer.
- El dispositivo es a batería o debe dormir entre lecturas → deep sleep con wakeup por timer o GPIO.

Si venís de Arduino UNO (single-thread): el cambio de mentalidad es que en ESP32 `loop()` corre sobre **una task de
FreeRTOS**, y podés lanzar más. `delay()` acá **cede la CPU** a otras tasks (no es el bloqueo duro de AVR), pero igual
no lo uses dentro de ISR ni de timers.

---

## 1. FreeRTOS — Tasks, Mutex, Queue, Semaphore

### Crear una task: `xTaskCreate`

```c
// Firma (Arduino-ESP32 / ESP-IDF)
 BaseType_t xTaskCreate(
     TaskFunction_t pxTaskCode,        // tu función
     const char * const pcName,        // nombre legible
     const uint16_t usStackDepth,      // stack en PALABRAS (1 word = 4 bytes)
     void * const pvParameters,        // parámetro (castear a void*)
     UBaseType_t uxPriority,           // 0..configMAX_PRIORITIES (0 = mínima)
     TaskHandle_t * const pxCreatedTask // handle o NULL
 );
```

Snippet de referencia (de `BasicMultiThreading`):

```c
void blinkTask(void *pvParameters) {
  pinMode(LED_BUILTIN, OUTPUT);
  while (1) {                       // una task NUNCA retorna
    digitalWrite(LED_BUILTIN, HIGH);
    delay(500);                     // delay() aqui cede CPU a otras tasks
    digitalWrite(LED_BUILTIN, LOW);
    delay(500);
  }
}

void setup() {
  Serial.begin(115200);
  xTaskCreate(blinkTask, "Blink Task", 2048, NULL, 5, NULL);
}
```

Notas clave de la doc oficial:
- **`usStackDepth` es en palabras, no bytes** → `2048` = 8192 bytes. Si ves
  `Stack canary watchpoint triggered (TaskX)` → subí este valor.
- Una task **debe tener un loop infinito** (`while(1)`) o **autoborrarse** con `vTaskDelete(NULL)`.
- Para borrar otra task guardá el handle: `xTaskCreate(..., &handle)` → `vTaskDelete(handle);`.
- En ESP32 dual-core podés fijar núcleo con `xTaskCreatePinnedToCore(..., core)`. Útil para aislar
  timing-crítico del loop principal ("Arduino Runs On" / "Events Run On" en el menú de tools).

### Mutex — proteger recurso compartido

Cuando dos tasks escriben/leen la misma variable, la ejecución puede cortarse entre medias y corromper el dato.
El ejemplo oficial `Mutex` crea dos tasks que escriben y leen una variable compartida: sin mutex hay mismatches;
con mutex el resultado es consistente.

```c
SemaphoreHandle_t mux = xSemaphoreCreateMutex();

void taskA(void *p) {
  while (1) {
    if (xSemaphoreTake(mux, portMAX_DELAY)) {   // espera hasta obtener
      sharedVar = compute();
      xSemaphoreGive(mux);
    }
  }
}
```

- **Mutex** = recursivo-amigo, con prioridad-herencia. Úsalo para proteger **recursos**.
- **Binary semaphore** = señalización "algo pasó" (típico: ISR → task).
- **Counting semaphore** = contar recursos/lugares libres.
- En ISR **nunca** uses `xSemaphoreTake` bloqueante; usá las versiones `...FromISR(..., &xHigherPriorityTaskWoken)`
  y `portYIELD_FROM_ISR()` al final.

### Queue — pasar datos task→task

Para mover muestras de sensor desde una ISR/task a otra sin race conditions:

```c
QueueHandle_t q = xQueueCreate(10, sizeof(int));   // 10 ítems de sizeof(int)

// productor
int v = analogRead(34);
xQueueSend(q, &v, 0);                              // no bloquea si llena

// consumidor
int got;
xQueueReceive(q, &got, portMAX_DELAY);             // bloquea hasta llegar ítem
```

- `xQueueSendFromISR` / `xQueueReceiveFromISR` para adentro de ISRs.
- Es la forma **correcta** de comunicar ISRs con tasks (mejor que variables globales volátiles).

---

## 2. Hardware Timers (`hw_timer_t`)

Para callbacks periódicos **precisos** sin bloquear (no usar `delay`). El Arduino-ESP32 core expone:

```c
hw_timer_t * timer = NULL;

void IRAM_ATTR onTimer() {              // ISR: IRAM_ATTR OBLIGATORIO
  // código corto, sin Serial.println() pesado ni malloc
  digitalWrite(PIN, !digitalRead(PIN));
}

void setup() {
  timer = timerBegin(1000000);          // 1 MHz => 1 tick = 1 us
  timerAttachInterrupt(timer, &onTimer, true);
  timerAlarm(timer, 1000000, true, 0);  // alarm cada 1e6 ticks=1s, autoreload=true
  timerStart(timer);
}
```

API del core (ref. `docs/en/api/timer.rst`):

| Función | Acción |
|---------|--------|
| `hw_timer_t* timerBegin(uint32_t frequency)` | Configura y devuelve handle (freq en Hz) |
| `void timerStart(timer)` / `timerStop(timer)` | Arranca / detiene el contador |
| `void timerRestart(timer)` | Reinicia el contador a 0 |
| `void timerEnd(timer)` | Libera y detiene |
| `void timerAttachInterrupt(timer, fn, edge)` | Conecta callback |
| `void timerAlarm(timer, alarm_value, autoreload, reload_count)` | Configura la alarma (se auto-activa) |

**Reglas dentro de un ISR de timer** (`IRAM_ATTR`):
- Código **mínimo y rápido**. Levantá un flag o mandá por una queue; procesá en una task.
- **No** `Serial.print` pesado, **no** `delay()`, **no** malloc, **no** locks de FreeRTOS que bloqueen.
- Usá `volatile` para flags leídos desde `loop()`.

---

## 3. Deep Sleep — `esp_deep_sleep_start` y wakeup sources

En deep sleep los CPUs, flash y la mayoría de periféricos se apagan. Quedan vivos: RTC, ULP coprocesador y RTC GPIOs.
**Al despertar el chip se resetea** → la ejecución arranca de nuevo desde el principio (no retoma donde se durmió),
salvo light-sleep.

### Entrar a dormir (siempre después de configurar wakeup)

```c
esp_deep_sleep_start();   // no retorna; tras wakeup el programa recomienza
```

### Wakeup por timer

```c
#include "esp_deep_sleep.h"

void setup() {
  Serial.begin(115200);
  esp_deep_sleep_enable_timer_wakeup(5 * 1000000ULL);  // 5 s en microsegundos
  esp_deep_sleep_start();
}
void loop() {}
```

### Wakeup por GPIO externo (ext0 / ext1)

- **ext0**: un solo **RTC GPIO** despierta por un nivel lógico fijo. Mantiene periféricos RTC prendidos
  (más consumo). Internal pull-up/down vía `rtc_gpio_pullup_en` / `rtc_gpio_hold_dis` antes de dormir.
- **ext1**: varios RTC GPIOs a la vez, controlado por el **RTC controller** → funciona **aún con periféricos
  RTC apagados** (menor consumo). El framework hace hold/unlock del pin automáticamente. Detectá qué pin fue
  con `esp_sleep_get_ext1_wakeup_status()`.

```c
// ext0: despierta cuando GPIO_NUM_0 está en HIGH
esp_sleep_enable_ext0_wakeup(GPIO_NUM_0, 1);

// ext1: múltiples pines (bitmask), level 0=low, 1=high
esp_sleep_enable_ext1_wakeup(BIT(GPIO_NUM_2) | BIT(GPIO_NUM_4), ESP_EXT1_WAKEUP_ANY_HIGH);
```

> Solo los **RTC GPIOs** sirven para wakeup externo en deep sleep. Consultá el datasheet del chip concreto
> para saber qué pines lo son. El flag `GPIO_IS_DEEP_SLEEP_WAKEUP_VALID_GPIO(n)` valida en runtime.

### Retener estado de pines en sleep: `gpio_hold_en`

Cuando el dominio de periféricos se apaga, los pines **quedan flotando** salvo que los "holdées":

```c
gpio_hold_en(GPIO_NUM_X);     // latchea el estado actual del pin durante sleep
// Para RTC GPIOs en deep sleep con RTC periph off:
//   esp_sleep_pd_domain(...)/rtc_gpio_hold_en según el modo.
```

- ext1 / RTC-periph-off → el framework hace hold automático de los wakeup pins.
- Para **otros pines** que querés mantener (ej: enable de un sensor) → `gpio_hold_en` **antes** de dormir,
  y `gpio_hold_dis(GPIO_NUM_X)` después de despertar para poder reconfigurar.

### Wakeup por ULP

El coprocesador ULP puede correr código mientras el SoC duerme (ADC, I2C simple, comparaciones) y despertar al
main core por condición. Se programa en assembly o con el ULP-RISC-V/Coproc en IDF. **Out of scope** de este
resumen — ver `examples/system/ulp` en ESP-IDF.

### Detectar causa de wakeup al boot

Tras un reset por wakeup, al inicio del programa:

```c
esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
switch (cause) {
  case ESP_SLEEP_WAKEUP_TIMER: /* ... */ break;
  case ESP_SLEEP_WAKEUP_EXT0:  /* ... */ break;
  case ESP_SLEEP_WAKEUP_EXT1:  {
      uint64_t pins = esp_sleep_get_ext1_wakeup_status();
      break;
  }
  case ESP_SLEEP_WAKEUP_UNDEFINED: /* power-on / reset real */ break;
}
```

---

## Gotchas

1. **Stack overflow (canary)**: si una task crashea con `Stack canary watchpoint triggered (TaskX)`,
   subí `usStackDepth`. Acordate: es en **palabras (4 bytes)**, no bytes. Llamadas anidadas, `Serial.print`
   con String y `printf` en flotante comen stack rápido.
2. **`delay()` en ESP32 NO es el de UNO**: cede la CPU (es `vTaskDelay`). Igual **prohibido** en ISR/timer callback.
3. **Watchdog (WDT)**: FreeRTOS tiene Task Watchdog. Una task que hace `while(1)` tight sin `vTaskDelay`/`yield`
   puede disparar el TWDT → reboot. Si necesitás spin lock corto, después liberá con `taskYIELD()` o `vTaskDelay(1)`.
   El Idle Task hook y `esp_task_wdt_*` controlan el comportamiento.
4. **ISR solo `IRAM_ATTR`**: funciones de callback de timer/interrupt deben llevar `IRAM_ATTR` o el código puede
   estar en flash (que está dormido durante ciertas operaciones) → Guru Meditation / crash.
5. **Pines flotando en sleep**: sin `gpio_hold_en` (o RTC hold), un pin que drives al dormirse queda flotante.
   Si controla un MOSFET/regulador → podés tener leakage o encender algo sin querer.
6. **ext0 consume más que ext1** porque mantiene periféricos RTC prendidos. Para battery → preferí ext1 o timer.
7. **`esp_deep_sleep_start()` no retorna** en el sentido de "sigue la línea siguiente": tras wakeup hay reset.
   Cualquier estado en RAM se pierde. Persistí en RTC memory (`RTC_DATA_ATTR`) lo que necesites entre ciclos.
8. **Solo RTC GPIOs** despiertan por ext0/ext1. No cualquier pin sirve — verificá con el datasheet del modelo
   exacto (ESP32 vs S3 vs C3 difieren).
9. **Frecuencia del timer**: `timerBegin(freq)` fija los ticks. `alarm_value` está en **ticks**, no microsegundos.
   Con `freq=1MHz` → 1 tick = 1 us (caso común). Con otra frecuencia hay que escalar.
10. **Dual-core y shared state**: dos cores corren tasks concurrentemente; cualquier variable compartida sin mutex
    es potencial race. `volatile` **no** garantiza atomicidad — solo que el compiler no cachea en registro.

---

## Fuentes

- Arduino-ESP32 core — `docs/en/api/timer.rst` (`timerBegin`, `timerAlarm`, `timerAttachInterrupt`).
- Arduino-ESP32 core — `libraries/ESP32/examples/FreeRTOS/BasicMultiThreading/README.md` (`xTaskCreate`, parámetros).
- Arduino-ESP32 core — `libraries/ESP32/examples/FreeRTOS/Mutex/README.md` (mutex / race conditions).
- Arduino-ESP32 core — `docs/en/api/deepsleep.rst` (`esp_deep_sleep_enable_timer_wakeup`, `esp_deep_sleep_start`).
- Arduino-ESP32 core — `docs/en/guides/tools_menu.rst` ("Arduino Runs On" / "Events On" — pinned to core).
- ESP-IDF — `docs/en/api-reference/system/sleep_modes.rst` (ext0, ext1, RTC IO, hold behavior).
- ESP-IDF — `docs/en/api-guides/low-power-mode/low-power-mode-soc.rst` (`esp_deep_sleep_start`).
- ESP-IDF — `docs/en/api-reference/system/power_management.rst` (`gpio_hold_en`).
- ESP-IDF — `docs/en/migration-guides/release-6.x/6.0/system.rst` (GPIO wakeup API nueva en v6.0).
- ESP-IDF — `examples/system/deep_sleep/README.md` (log de wakeup, ext1 pins).

Resueltas vía Context7: `/espressif/arduino-esp32` y `/espressif/esp-idf` (Source Reputation: High).
