---
name: esp32-connectivity
description: Use when writing ESP32 network code — connecting WiFi (station or AP), publishing/subscribing MQTT via PubSubClient, or making HTTP client/server requests. Covers Arduino-ESP32 core 3.x WiFi/Network APIs, PubSubClient API, reconnect patterns, credentials via env, and timeouts.
---

# ESP32 Connectivity (WiFi / MQTT / HTTP)

Reference guide for **ESP32 networking on the Arduino framework**: WiFi
(Station + Access Point), MQTT via `PubSubClient`, and HTTP (client + server)
using the **Arduino-ESP32 core**. APIs, snippets, reconnect patterns, gotchas.

> **NOTA — todo comando build/flash aquí es REFERENCIA.** Ningún comando debe
> ejecutarse sin confirmación explícita del usuario. Esta skill describe APIs y
> código de referencia; no corre nada.

> **Core version**: Arduino-ESP32 core 3.x renombró `WiFiClient`/`WiFiServer` a
> `NetworkClient`/`NetworkServer` e introdujo la API orientada a objetos
> `WiFi.STA` / `WiFi.AP`. La API clásica (`WiFi.begin`, `WiFi.softAP`) sigue
> disponible y es la más portable. Ambas se muestran abajo.

## Cuándo usarla

- Necesitás conectar el ESP32 a WiFi (modo station) o crear un Access Point.
- Integrás MQTT (publicar/suscribir) con un broker usando `PubSubClient`.
- Hacés requests HTTP salientes (GET/POST) o servís HTTP desde el ESP32.
- Diagnosticás reconexiones, timeouts, o manejo de credenciales en firmware.

## 1. WiFi — Station (STA) mode

Conecta el ESP32 como cliente a un access point existente.

### API clásica (portable, recomendada para compatibilidad)

```arduino
#include <WiFi.h>

// Credenciales: NUNCA hardcodear en producción. Ver "Gotchas" → env/secrets.
const char* WIFI_SSID = "YOUR_SSID";
const char* WIFI_PASS = "YOUR_PASSWORD";

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);          // set station mode
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.print("Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Connected, IP: ");
  Serial.println(WiFi.localIP());
}
```

Métodos clave:

| Método | Descripción |
|--------|-------------|
| `WiFi.mode(WIFI_STA)` | Configura modo station |
| `WiFi.begin(ssid, pass)` | Inicia conexión a AP |
| `WiFi.status()` | Estado actual; `WL_CONNECTED` = conectado |
| `WiFi.localIP()` | `IPAddress` asignada por DHCP |
| `WiFi.disconnect()` | Desconecta del AP |
| `WiFi.RSSI()` | Fuerza de señal |
| `WiFi.macAddress()` | MAC del ESP32 |

### API nueva (core 3.x — `WiFi.STA`)

```arduino
#include <Network.h>
#include <WiFi.h>

void setup() {
  Network.begin();
  WiFi.STA.begin();
  WiFi.STA.connect("ssid", "password");
  while (WiFi.STA.status() != WL_CONNECTED) delay(500);
  Serial.println(WiFi.STA.localIP());
}
```

> `WiFi.STA.status()`, `WiFi.STA.localIP()` son los equivalentes orientados a
> objetos. Mismo patrón de polling con `WL_CONNECTED`.

### `wl_status_t` — códigos de estado

| Constante | Significado |
|-----------|-------------|
| `WL_IDLE_STATUS` | Temporal, cambiando |
| `WL_NO_SSID_AVAIL` | SSID no encontrado |
| `WL_CONNECT_FAILED` | Password incorrecta / 4-way handshake falló |
| `WL_CONNECTION_LOST` | Conexión perdida |
| `WL_DISCONNECTED` | Desconectado |
| `WL_CONNECTED` | Conectado |

## 2. WiFi — Access Point (AP) mode

El ESP32 crea su propia red WiFi; otros dispositivos se conectan a él. Útil para
captive portals, configuración inicial, o servir HTTP sin router.

### API clásica

```arduino
#include <WiFi.h>

const char* AP_SSID  = "ESP32-Setup";
const char* AP_PASS  = "password123";  // min 8 chars para WPA2; NULL = open

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.print("AP IP: ");
  Serial.println(WiFi.softAPIP());   // típicamente 192.168.4.1
}

void loop() {
  Serial.printf("Stations conectadas: %d\n", WiFi.softAPgetStationNum());
  delay(2000);
}
```

Firma completa (core oficial):

```cpp
bool softAP(const char* ssid,
            const char* passphrase = NULL,
            int channel = 1,
            int ssid_hidden = 0,
            int max_connection = 4,
            bool ftm_responder = false);
bool softAPConfig(IPAddress local_ip, IPAddress gateway, IPAddress subnet);
bool softAPdisconnect(bool wifioff = false);
uint8_t softAPgetStationNum();
IPAddress softAPIP();
```

### API nueva (core 3.x — `WiFi.AP`)

```arduino
Network.begin();
WiFi.AP.begin();
WiFi.AP.create("MyESP32AP", "password123");
Serial.println(WiFi.AP.localIP());
```

### STA + AP simultáneo (dual mode)

```arduino
WiFi.mode(WIFI_AP_STA);  // ambos modos a la vez
```

## 3. MQTT — `PubSubClient`

Librería de Nick O'Leary (`knolleary/pubsubclient`). Es la librería de facto
para MQTT en ESP32/ESP8266. **No es parte del core** — instalala vía Library
Manager (referencia, requiere confirmación):

```bash
arduino-cli lib install "PubSubClient"
```

### Setup mínimo

```arduino
#include <WiFi.h>
#include <PubSubClient.h>

const char* MQTT_BROKER = "broker.example.com";
const uint16_t MQTT_PORT = 1883;            // 8883 para TLS (ver TLS gotcha)
const char* MQTT_CLIENT_ID = "esp32-001";
const char* TOPIC_SUB = "esp32/cmd";
const char* TOPIC_PUB = "esp32/telemetry";

WiFiClient   netClient;          // usa WiFiClientSecure + setInsecure() para TLS
PubSubClient client(netClient);

// Callback: se invoca cuando llega un mensaje en un topic suscrito.
// NO publiques desde acá (ver Gotchas) — setea un flag y procesalo en loop().
void onMessage(char* topic, byte* payload, unsigned int length) {
  Serial.print("Message arrived [");
  Serial.print(topic);
  Serial.print("]: ");
  for (unsigned int i = 0; i < length; i++) Serial.write((char)payload[i]);
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  // ... WiFi STA connect aquí (ver sección 1) ...

  client.setServer(MQTT_BROKER, MQTT_PORT);
  client.setCallback(onMessage);
}

void loop() {
  if (!client.connected()) {
    reconnectMqtt();
  }
  client.loop();   // MANDATORIO en cada iteración — procesa la cola MQTT
}

void reconnectMqtt() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection... ");
    if (client.connect(MQTT_CLIENT_ID)) {
      Serial.println("connected");
      client.subscribe(TOPIC_SUB);
      client.publish(TOPIC_PUB, "hello");   // last-will / birth opcional
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());         // ver tabla de states abajo
      Serial.println(" try again in 5s");
      delay(5000);
    }
  }
}
```

### API clave de `PubSubClient`

| Método | Descripción |
|--------|-------------|
| `setServer(host, port)` | Configura broker y puerto |
| `setCallback(fn)` | Registra callback de mensaje entrante |
| `connect(clientId [, user, pass, willTopic, willQos, willRetain, willPayload])` | Conecta al broker; retorna `bool` |
| `connected()` | `true` si está conectado |
| `loop()` | **Procesa red y callbacks — llamar en cada `loop()`** |
| `subscribe(topic [, qos])` | Suscribe a un topic |
| `unsubscribe(topic)` | Cancela suscripción |
| `publish(topic, payload [, retained])` | Publica mensaje |
| `beginPublish` / `write` / `endPublish` | Publicar payloads grandes/streaming |
| `state()` | Código de estado de la última conexión |
| `setBufferSize(size)` | Aumenta buffer (default 256 bytes) para payloads grandes |
| `setKeepAlive(seconds)` | Ajusta keepalive |
| `setSocketTimeout(seconds)` | Timeout de socket (default 15s) |

### `client.state()` — códigos de error de conexión

| Código | Significado |
|--------|-------------|
| `-4` | `MQTT_CONNECTION_TIMEOUT` — servidor no respondió a tiempo |
| `-3` | `MQTT_CONNECTION_LOST` — conexión caída |
| `-2` | `MQTT_CONNECT_FAILED` — no se pudo establecer TCP |
| `-1` | `MQTT_DISCONNECTED` — desconectado, no conectado aún |
| `0`  | `MQTT_CONNECTED` — conectado |
| `1`  | protocol version no soportada |
| `2`  | client ID rechazado |
| `3`  | broker no disponible |
| `4`  | usuario/password malos |
| `5`  | no autorizado |

### TLS / MQTTS (puerto 8883)

Para TLS usá `WiFiClientSecure` en lugar de `WiFiClient`:

```arduino
#include <WiFiClientSecure.h>
WiFiClientSecure netClient;
// netClient.setInsecure();   // omite validación de certificado — DEV solo
// Para producción: netClient.setCACert(root_ca);
PubSubClient client(netClient);
client.setServer("broker.example.com", 8883);
```

## 4. HTTP — Client

### `WiFiClient` / `NetworkClient` (TCP crudo, core API)

```arduino
NetworkClient client;

void loop() {
  if (client.connect("www.example.com", 80)) {
    client.println("GET / HTTP/1.1");
    client.println("Host: www.example.com");
    client.println("Connection: close");
    client.println();

    // TIMEOUT obligatorio (ver Gotchas)
    unsigned long deadline = millis() + 5000;
    while (client.available() == 0 && millis() < deadline) delay(10);
    if (client.available() == 0) {
      Serial.println(">>> Client Timeout!");
      client.stop();
      return;
    }
    while (client.available()) {
      String line = client.readStringUntil('\r');
      Serial.print(line);
    }
    client.stop();
  }
  delay(10000);
}
```

> **Core 3.x**: `WiFiClient` y `NetworkClient` son aliases; el código nuevo usa
> `NetworkClient`. Los métodos (`connect`, `available`, `read`, `print`,
> `stop`) son idénticos.

### `HTTPClient` (wrapper de alto nivel)

```arduino
#include <HTTPClient.h>

HTTPClient http;
if (http.begin("http://api.example.com/data")) {
  int code = http.GET();              // también POST, PUT, DELETE
  if (code > 0) {
    String payload = http.getString();
    Serial.printf("HTTP %d\n", code);
    Serial.println(payload);
  } else {
    Serial.printf("GET failed: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}
```

Para HTTPS usá `WiFiClientSecure`:

```arduino
WiFiClientSecure sec;
sec.setInsecure();                   // DEV; setCACert() en producción
HTTPClient http;
http.begin(sec, "https://api.example.com/data");
```

## 5. HTTP — Server (`WebServer`)

```arduino
#include <WebServer.h>

WebServer server(80);

void handleRoot() {
  server.send(200, "text/plain", "Hello from ESP32!");
}

void handleNotFound() {
  server.send(404, "text/plain", "Not found");
}

void setup() {
  // ... WiFi connect ...

  server.on("/", handleRoot);
  server.onNotFound(handleNotFound);
  server.begin();
}

void loop() {
  server.handleClient();   // procesa requests entrantes
}
```

## Gotchas

1. **Credenciales NUNCA en el código.** Usar `secrets.h` gitignored o constantes
   inyectadas por build. Para (`WIFI_SSID`, `WIFI_PASS`, tokens MQTT) preferir:
   - `secrets.h` con `#define` y entry en `.gitignore`.
   - Compile-time `-D WIFI_SSID=\"...\"` desde el build system.
   - `Preferences` (NVS) para configuración post-flash, cargada por captive portal.
   NUNCA subas credenciales reales al repo.

2. **`client.loop()` es mandatorio en MQTT.** Sin llamarlo en cada iteración del
   `loop()` principal, no se procesan mensajes ni se mantiene viva la conexión
   (keepalive). Olvidarlo = desconexión silenciosa.

3. **No publiques desde el callback de MQTT.** El callback corre dentro de
   `client.loop()`; publicar ahí puede reentrar y colgar la librería. Seteá un
   flag / encolá el dato y publicalo desde el `loop()` principal.

4. **Reconnect con backoff, no bloqueante.** El patrón `while(!connected) delay()`
   bloquea todo el firmware. Para producción: usar `millis()` con timeout y
   reintentar cada N segundos, dejando que el resto del código siga corriendo.

5. **Timeout de respuesta siempre.** `client.available()` puede nunca llegar.
   Siempre envolver en un deadline con `millis()` (ej. 5s) y llamar `stop()`.

6. **`softAP` password mínimo 8 chars** para WPA2. Si pasás `NULL` o <8 chars,
   queda como red abierta. `max_connection` default = 4.

7. **Buffer MQTT default = 256 bytes.** Si tus payloads son más grandes
   (`client.setBufferSize(1024)` antes de `connect`), si no se truncan. El
   `connect()` reserva el buffer.

8. **TLS `/setInsecure()` es DEV only.** En producción usá `setCACert(root_ca)`
   con el certificado root del broker/servidor embebido. `setInsecure()` omite
   validación = vulnerable a MITM.

9. **`WiFi.mode()` antes de `begin`/`softAP`.** Si no seteás modo explícito,
   el default es `WIFI_OFF` y la conexión falla silenciosamente.

10. **QD001 / acebott**: si trabajás con el robot QD001, recordá que la
    conectividad puede convivir con motores/sensores — priorizar
    no-bloqueante (gotcha #4) para no degradar el control loop.

## Fuentes

- Arduino-ESP32 core (Espressif) — WiFi/Network API, STA/AP, TCP client/server:
  https://github.com/espressif/arduino-esp32/blob/master/docs/en/api/network.rst
- Arduino-ESP32 core — WiFi API (STA + softAP):
  https://github.com/espressif/arduino-esp32/blob/master/docs/en/api/wifi.rst
- Arduino-ESP32 core — ejemplos WiFiClient/WiFiScanTime:
  https://github.com/espressif/arduino-esp32/tree/master/libraries/WiFi/examples
- Arduino-ESP32 core — WebServer library:
  https://github.com/espressif/arduino-esp32/tree/master/libraries/WebServer
- PubSubClient (Nick O'Leary) — API oficial:
  https://pubsubclient.knolleary.net/api.html
- PubSubClient — repo oficial:
  https://github.com/knolleary/pubsubclient
