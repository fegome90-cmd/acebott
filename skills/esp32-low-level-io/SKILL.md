---
name: esp32-low-level-io
description: Use when working with ESP32 (classic / S2 / S3 / C3 / C6) low-level hardware I/O in the Arduino core — I2C (`Wire`), SPI (`SPI` / `HSPI` / `VSPI` / `FSPI`), ADC (`analogRead`, `analogSetAttenuation`, `analogReadResolution`), and DAC (`dacWrite`). Covers APIs, default pins per variant, reference snippets, and the classic gotchas (ADC non-linearity, ADC2 vs Wi-Fi conflict, strapping pins, bus pin conflicts). Cite the official docs; do not fabricate values.
---

# ESP32 Low-Level I/O (I2C/SPI/ADC/DAC)

Reference skill for the **Arduino-ESP32 core** (`arduino-esp32` by Espressif). All APIs and pin facts below are cited from the official `docs/en/api/*.rst`. This is a **reference**, not a runner — confirm before executing any code on hardware.

## Cuándo usarla

- Necesitás leer o escribir a nivel de hardware sobre un ESP32 (cualquier variante: clásico, S2, S3, C3, C6).
- Configurás pines de bus I2C/SPI, leés sensores analógicos con ADC, o sacás voltaje por DAC.
- Pegás un bug de "ADC lee cualquier cosa", "I2C no anduvo hasta que cambié pines", "el S3 se reinicia en boot" — casi siempre es strapping / bus conflict / ADC2+WiFi.
- Revisás código Arduino-ESP32 de acebott que toca `Wire`, `SPI`, `analogRead`, `dacWrite`.

> Regla: ante la duda de un pin o rango, verificá contra la doc citada en `## Fuentes`. **No fabriques valores** — el ADC y los pines son traicioneros entre variantes.

---

## I2C — `Wire`

API oficial (`docs/en/api/i2c.rst`):

```cpp
bool begin();                                   // master, pines y frecuencia por defecto
bool begin(int sdaPin, int sclPin, uint32_t frequency);  // master con pines custom
bool begin(uint8_t address);                    // slave
bool setPins(int sdaPin, int sclPin);           // debe llamarse ANTES de begin()
bool setClock(uint32_t frequency);              // p.ej. 400000 para Fast Mode
uint32_t getClock();
void setTimeOut(uint16_t timeOutMillis);
uint16_t getTimeOut();
// Slave callbacks:
void onRequest(void (*callback)(void));
void onReceive(void (*callback)(int len));
```

**Pines por defecto (ESP32 clásico):** SDA = **GPIO21**, SCL = **GPIO22** (`docs/en/tutorials/io_mux.rst`).

**Pinout flexible (GPIO matrix):** a diferencia del Arduino Uno, el ESP32 permite asignar I2C a casi cualquier GPIO. Para mover el bus:

```cpp
// REFERENCIA — confirmá que los pines elegidos no sean input-only / strapping
Wire.setPins(16, 17);   // SDA, SCL  -> ANTES de begin()
Wire.begin();           // master
```

Master read típico (registros):

```cpp
Wire.beginTransmission(0x68);   // p.ej. MPU6050 / DS3231
Wire.write(0x75);               // registro a leer
Wire.endTransmission(false);    // repeated start
Wire.requestFrom(0x68, 1);
uint8_t whoami = Wire.read();
```

> Variantes S2/S3/C3: el default de SDA/SCL **varía por board**. Si la board expone `SDA`/`SCL` como macros, usalas; si no, llamá `Wire.setPins()` explícito. No asumas 21/22 en un S3.

---

## SPI — `SPI` / `SPIClass`

API oficial (`docs/en/api/spi.rst`). El ESP32 clásico expone **HSPI** y **VSPI** (dos buses hardware); el core 3.x llama **FSPI** al bus por defecto y permite instanciar múltiples `SPIClass`:

```cpp
#include <SPI.h>

SPIClass spi1(HSPI);
SPIClass spi2(VSPI);

void setup() {
  // orden: SCK, MISO, MOSI, SS
  spi1.begin(14, 12, 13, 15);
  spi2.begin(18, 19, 23, 5);
}

void loop() {
  spi1.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  spi1.transfer(0x00);
  spi1.endTransaction();
}
```

API estándar heredada de Arduino:

```cpp
SPI.begin(sck, miso, mosi, cs);                 // pines custom (sobrecarga ESP32)
SPI.setBitOrder(MSBFIRST / LSBFIRST);
SPI.setDataMode(SPI_MODE0);                     // MODE0..MODE3 (CPHA/CPOL)
SPI.setClockDivider(SPI_CLOCK_DIV4);            // o usar SPISettings (preferido)
uint8_t SPI.transfer(uint8_t data);
void   SPI.transferBytes(uint8_t *out, uint8_t *in, uint32_t size);
SPI.beginTransaction(SPISettings(speed, bitOrder, dataMode));
SPI.endTransaction();
```

**Pines VSPI por defecto (ESP32 clásico):** SCK=18, MISO=19, MOSI=23, SS=5. **HSPI:** SCK=14, MISO=12, MOSI=13, SS=15. (`docs/en/api/spi.rst`.)

> Preferí `beginTransaction(SPISettings(...))` sobre `setClockDivider` — es thread-safe entre dispositivos que comparten el bus y explícito en velocidad.

### Gotcha S3 + QSPI/OPI flash/PSRAM
En boards como **ESP32-S3-WROOM-2**, los pines por defecto de flash/PSRAM (QSPI/OPI) **colisionan con los de SPI/SD_MMC**. Usá `setPins()` con GPIO libre (`libraries/SD_MMC/README.md`, `docs/en/troubleshooting.rst`). Síntoma: boot loop con `Octal Flash Mode Enabled` / `For OPI Flash, Use Default Flash Boot Mode`.

---

## ADC — `analogRead`

API oficial (`docs/en/api/adc.rst`):

```cpp
uint16_t analogRead(uint8_t pin);                      // valor crudo, no calibrado
void analogReadResolution(uint8_t bits);               // default 12 bits (0..4095); rango 1..16
void analogSetAttenuation(adc_attenuation_t atten);    // aplica a TODOS los canales
void analogSetPinAttenuation(uint8_t pin, adc_attenuation_t atten);  // por pin
```

**Atenuaciones** (`adc_attenuation_t`, ESP32 clásico):

| Constante | Rango efectivo aprox. |
|-----------|----------------------|
| `ADC_ATTEN_DB_0`   | ~100–950 mV |
| `ADC_ATTEN_DB_2_5` | hasta ~1.5 V |
| `ADC_ATTEN_DB_6`   | hasta ~2.2 V |
| `ADC_ATTEN_DB_11`  | hasta ~3.1 V (uso típico a 3.3 V) |

(Valores de rango aprox.; referencia nominal 1100 mV, varía entre chips 1000–1200 mV. Fuente: Espressif IDF/Arduino docs.)

```cpp
// REFERENCIA — lector simple, calibrá si necesitás precisión
analogReadResolution(12);
analogSetAttenuation(ADC_ATTEN_DB_11);   // para leer hasta ~3.1V
uint16_t raw = analogRead(34);            // GPIO34 = ADC1_CH6 (input-only, safe con WiFi)
float v = (raw / 4095.0) * 3.3;           // aproximado; no lineal en los extremos
```

### Gotchas ADC
- **No es lineal** en los extremos del rango, especialmente cerca de 0 V y del máximo. Para precisión usá calibración (`esp_adc_cal`) o hacé una lookup table.
- **ADC2 + Wi-Fi = conflicto.** Los canales de **ADC2** (GPIO 0,2,4,12,13,14,15,25,26,27 en ESP32 clásico) **no se pueden usar mientras Wi-Fi esté activo**. Usá pines de **ADC1** (GPIO 32–39) para lecturas confiables cuando hay radio encendida.
- **`analogReadResolution`** en ESP32 acepta 9–12 bits (cambia hardware); fuera de eso solo shiftea el valor.
- **ESP32-S2 v0.0** tiene errata: ADC default 13 bits. Fijo en v1.0+ (`docs/en/api/adc.rst`).

---

## DAC — `dacWrite`

API oficial (`docs/en/api/dac.rst`):

```cpp
void dacWrite(uint8_t pin, uint8_t value);   // value 0..255 -> 0 V..3.3 V
// uint8_t dacRead(uint8_t pin);              // lee el valor cargado en el DAC
// void dacDisable(uint8_t pin);              // libera el pin
```

**Pines DAC (solo ESP32 clásico):** **GPIO25** (DAC1) y **GPIO26** (DAC2). `value` 128 ≈ mitad de tensión.

> **S2 / S3 / C3 / C6 NO tienen DAC hardware.** Si necesitás salida analógica ahí, usá PWM + RC o LEDC + filtro (`ledcWrite`), no `dacWrite`.

```cpp
// REFERENCIA — rampa de voltaje en GPIO25
for (uint8_t v = 0; v < 255; v++) {
  dacWrite(25, v);
  delay(2);
}
```

---

## Gotchas (cross-cutting)

- **Strapping pins** (ESP32 clásico): GPIO0, GPIO2, GPIO5, GPIO12, GPIO15 afectan el modo de boot. No los uses como entrada analógica/bus sin tener presente su estado en reset. GPIO12 (MTDI) en alto durante boot = flash a 1.8 V y boot falla.
- **GPIO 34–39 son input-only** (sin pull-ups/pull-downs internos). Ideales para ADC1, pero no podés usarlos como SDA/SCL/MOSI de salida.
- **WiFi + ADC2:** ya citado — pegá siempre a ADC1 cuando haya radio.
- **Bus conflicts en S3:** flash/PSRAM QSPI/OPI ocupa pines que en el clásico eran SPI libre. Reasigná con `setPins()`.
- **Pull-ups I2C:** el ESP32 tiene pull-ups internos débiles (~45 kΩ). Para buses con varios dispositivos o a 400 kHz, agregá pull-ups externos de 4.7–10 kΩ.
- **`analogWrite` NO existe** en el core ESP32 (fue removido). Usá `ledcWrite` (LEDC) para PWM — está fuera del scope de esta skill.

---

## Fuentes

- arduino-esp32 core: `docs/en/api/i2c.rst`, `docs/en/api/spi.rst`, `docs/en/api/adc.rst`, `docs/en/api/dac.rst` — https://github.com/espressif/arduino-esp32/tree/master/docs/en/api
- io_mux tutorial (pines por defecto I2C 21/22, GPIO matrix): https://github.com/espressif/arduino-esp32/blob/master/docs/en/tutorials/io_mux.rst
- SD_MMC pin conflicts S3: https://github.com/espressif/arduino-esp32/blob/master/libraries/SD_MMC/README.md
- Troubleshooting (S3 OPI flash boot loop): https://github.com/espressif/arduino-esp32/blob/master/docs/en/troubleshooting.rst
- IDF ADC reference (rangos por atenuación, ref nominal 1100 mV): https://docs.espressif.com/projects/esp-idf/en/v4.4/esp32/api-reference/peripherals/adc.html
