````markdown
# 🧭 Fused Channel Protocol & JS Library (`fused-channel`)

A **tiny browser-native messaging library** (≈2 KB) for connecting independent web components — such as Fused UDFs, maps, histograms, and dashboards — into a unified, filter-aware system.

It builds on `BroadcastChannel`, automatically falls back to `EventTarget`, and defines a clean, AI-friendly protocol for filter events (`bounds`, `range`, `categorical`, `clear`).

---

## 🚀 Overview

`fused-channel` makes each visualization or UI block a node in a shared "conversation."  
You can broadcast structured messages between iframes, dashboards, and custom HTML components — all client-side.

| Event Type | Typical Payload | Example Use |
|-------------|-----------------|--------------|
| `filter/bounds.changed` | `{ geometry: { type:"BBox", bbox:[W,S,E,N] }, zoom }` | Map sends visible extent |
| `filter/range.changed` | `{ field:"area_km", range:[0,100] }` | Histogram brush sends numeric range |
| `filter/categorical.changed` | `{ field:"land_use", values:["residential","industrial"] }` | Dropdown selects categories |
| `filter/clear` | `{ scope:"all"|"field", field? }` | Resets filters across widgets |

All messages stay inside the browser context (no server, no WebSocket).

---

## 📦 Installation & Loading

### Via CDN (recommended)

```html
<script src="https://cdn.jsdelivr.net/gh/milind-soni/fused-channel@v0.2.0/channel.js"></script>
````

### Via npm (planned)

```bash
npm install fused-channel
```

```js
import fusedChannel from "fused-channel";
```

---

## 🧩 API Reference

### `fusedChannel(name?: string, opts?: object)`

Create a channel instance.

```js
const ch = fusedChannel("fused-bus", { origin: "map", version: "1.0" });
```

#### Options

| Key               | Type     | Default  | Description                     |
| ----------------- | -------- | -------- | ------------------------------- |
| `origin`          | `string` | `"udf"`  | Component or source name        |
| `version`         | `string` | `"1.0"`  | Protocol version                |
| `maxPayloadBytes` | `number` | `100000` | Guard against oversize messages |

---

### `ch.publish(type, payload?)`

Broadcast any structured message.

```js
ch.publish("custom/event", { hello: "world" });
```

Each message looks like:

```jsonc
{
  "type": "custom/event",
  "payload": { "hello": "world" },
  "origin": "map",
  "channel": "fused-bus",
  "ts": 1728530029000,
  "version": "1.0"
}
```

---

### `ch.on(type, handler) → unsubscribe()`

Listen for a specific message type.

```js
const stop = ch.on("filter/range.changed", msg => {
  console.log("New range:", msg.payload);
});
```

Call `stop()` to unsubscribe.

---

### `ch.onAny(handler) → unsubscribe()`

Listen for **all** message types.

```js
ch.onAny(msg => console.log(msg.type, msg.payload));
```

---

### `ch.off(type, handler)`

Remove a specific listener manually.

---

### `ch.close()`

Close the underlying `BroadcastChannel` or event target, releasing all handlers.

---

### `ch.filter` — Filter Helper Namespace

Shorthand helpers for standardized events:

| Method                                           | Description                 | Example                                                     |
| ------------------------------------------------ | --------------------------- | ----------------------------------------------------------- |
| `filter.bounds({ bbox, zoom, dataset })`         | Publish map extent          | `ch.filter.bounds({ bbox:[-125,24,-66,49], zoom:5 })`       |
| `filter.range({ field, range, dataset })`        | Publish numeric range       | `ch.filter.range({ field:'area_km', range:[0,10] })`        |
| `filter.categorical({ field, values, dataset })` | Publish category selections | `ch.filter.categorical({ field:'type', values:['A','B'] })` |
| `filter.clear(scope?, extra?)`                   | Clear filters               | `ch.filter.clear('field', { field:'area_km' })`             |

---

## 🔁 Message Envelope Specification

Every message follows this shape:

```jsonc
{
  "type": "filter/range.changed",
  "payload": {
    "field": "area_km",
    "range": [0, 10],
    "dataset": "all"
  },
  "origin": "histogram",
  "channel": "fused-bus",
  "ts": 1728530029000,
  "version": "1.0"
}
```

---

## 🧠 Protocol Glossary

### Core Filter Events

| Type                         | Payload                                                      | Description                  |                           |
| ---------------------------- | ------------------------------------------------------------ | ---------------------------- | ------------------------- |
| `filter/bounds.changed`      | `{ geometry:{type:"BBox",bbox:[W,S,E,N]}, zoom?, dataset? }` | Spatial extent               |                           |
| `filter/range.changed`       | `{ field, range:[min,max], dataset? }`                       | Continuous range filter      |                           |
| `filter/categorical.changed` | `{ field, values:[...], dataset? }`                          | Discrete/categorical filter  |                           |
| `filter/clear`               | `{ scope:"all"                                               | "field", field?, dataset? }` | Clears one or all filters |

### Common Utility Events

| Type              | Description                                         |
| ----------------- | --------------------------------------------------- |
| `component/ready` | A component announcing readiness                    |
| `filter/applied`  | A component confirms it applied a filter            |
| `filter/error`    | Optional: broadcast filter parsing/validation error |

---

## 🧩 Practical Examples

### 🔹 Minimal Map → Histogram Communication

**Map sender:**

```js
const ch = fusedChannel("fused-bus", { origin: "map" });

function publishBounds(bounds) {
  ch.filter.bounds({
    bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
    zoom: map.getZoom(),
    dataset: "all"
  });
}

map.on("moveend", () => publishBounds(map.getBounds()));
```

---

**Histogram sender (range):**

```js
const ch = fusedChannel("fused-bus", { origin: "histogram" });

brush.on("end", e => {
  if (!e.selection)
    return ch.filter.clear("field", { field: "area_km" });

  const [x0, x1] = e.selection;
  const min = xScale.invert(x0);
  const max = xScale.invert(x1);
  ch.filter.range({ field: "area_km", range: [min, max], dataset: "all" });
});
```

---

**Receiver example:**

```js
const ch = fusedChannel("fused-bus");

ch.on("filter/bounds.changed", msg => {
  const [w, s, e, n] = msg.payload.geometry.bbox;
  console.log("Received bounds:", w, s, e, n);
});

ch.on("filter/range.changed", msg => {
  console.log("Range filter applied:", msg.payload.field, msg.payload.range);
});
```

---






Perfect — let’s break this down **step by step** in very simple, practical terms.
You’ve basically built a **tiny communication system** for your maps, charts, and dashboards — something like a local “chat room” where your visual components talk to each other instantly.

---

## 🧩 What the `fusedChannel` Code Actually Does

Here’s what’s going on behind the scenes in your `channel.js` file — explained like you’re teaching it to someone new.

---

### 1️⃣ You create a “Channel” (a private chat line)

```js
const ch = fusedChannel("fused-bus");
```

This line opens a shared “message bus” named `"fused-bus"`.

Every iframe, chart, map, or UDF that also connects to `"fused-bus"` can now send or receive messages instantly.

Think of it like a **walkie-talkie frequency**:

* If two UDFs use the same name — `"fused-bus"` — they hear each other.
* If one uses `"histogram"` and another uses `"map"`, they won’t hear each other.

---

### 2️⃣ You send (publish) a message

```js
ch.publish("filter/range.changed", { field: "area_km", range: [0, 10] });
```

This says:

> “Hey everyone listening on the `fused-bus` — a **range filter** just changed!
> The user selected area values between 0 and 10.”

That message gets sent to all connected components (in the same tab, dashboard, or Fused Canvas).

---

### 3️⃣ Others can listen for it

```js
ch.on("filter/range.changed", (msg) => {
  console.log("Got range filter:", msg.payload);
});
```

Now, whenever someone sends a `filter/range.changed` message, this handler will run.
So your chart or map can react — for example, by filtering its own data to match that area range.

---

### 4️⃣ What the `.changed` part means

That’s just a **naming convention**.

It means “something has changed.”
So you can think of:

* `filter/range.changed` → a numeric range changed (like brushing a histogram)
* `filter/bounds.changed` → the visible map area changed (like panning or zooming)
* `filter/categorical.changed` → selected categories changed (like picking “restaurants + bars”)

You could also define others later, like:

* `filter/selection.changed`
* `layer/visibility.changed`
* `theme/mode.changed`

So `.changed` doesn’t do anything special in code — it’s just part of the message name.
It makes your system self-descriptive and readable by humans *and* AI.

---

### 5️⃣ `.filter` helpers are shortcuts

Instead of writing:

```js
ch.publish("filter/range.changed", { field: "area_km", range: [0,10] });
```

You can just do:

```js
ch.filter.range({ field: "area_km", range: [0,10] });
```

That’s like having a mini API for common events.

---

### 6️⃣ `.onAny()` listens to everything

If you want to log or debug all messages going through your system:

```js
ch.onAny((msg) => console.log(msg.type, msg.payload));
```

That’s like having a “console tap” into your message bus.

---

### 7️⃣ Unsubscribe and close (cleaning up)

```js
const stop = ch.on("filter/range.changed", handler);
stop(); // removes listener

ch.close(); // closes the channel completely
```

This keeps your app clean when a component is destroyed or reloaded.

---

### 8️⃣ The message object shape

Every message looks like this:

```json
{
  "type": "filter/range.changed",
  "payload": {
    "field": "area_km",
    "range": [0, 10],
    "dataset": "all"
  },
  "origin": "histogram",
  "channel": "fused-bus",
  "ts": 1728530029000,
  "version": "1.0"
}
```

So you always know:

* **`type`** → what kind of event this is
* **`payload`** → what data is inside
* **`origin`** → which component sent it
* **`channel`** → which bus it belongs to
* **`ts`** → timestamp (milliseconds)
* **`version`** → protocol version

---

### 9️⃣ Behind the scenes: `BroadcastChannel`

The magic is the built-in browser API:

```js
new BroadcastChannel("fused-bus")
```

It’s like a radio frequency inside the browser tab:

* Every iframe on the same domain can talk.
* It’s extremely fast (microseconds).
* It needs **no server**, **no WebSocket**, **no iframe parent wiring**.

If `BroadcastChannel` isn’t supported, your code quietly falls back to a local `EventTarget`, so it still works in older browsers.

---

### 🔟 Why this matters

It gives your AI-generated or user-created UDFs:

* a **universal language** to talk to each other,
* an **easy-to-parse protocol** (`filter/range.changed`, `filter/bounds.changed`, etc.),
* and a **clean abstraction** to build any interactive data story:

  * map + chart + dropdown + stats pill + legend
  * all synchronized through one consistent bus.

---

### ✅ In short

| You want to…          | You call…                                            |
| --------------------- | ---------------------------------------------------- |
| Send a custom message | `ch.publish("custom/event", { foo: 1 })`             |
| Listen for a type     | `ch.on("custom/event", fn)`                          |
| Listen to everything  | `ch.onAny(fn)`                                       |
| Send map bounds       | `ch.filter.bounds({ bbox:[-125,24,-66,49] })`        |
| Send histogram range  | `ch.filter.range({ field:"area_km", range:[0,10] })` |
| Clear filters         | `ch.filter.clear("all")`                             |
| Stop listening        | `stop()`                                             |
| Close the channel     | `ch.close()`                                         |

---

Would you like me to append this explanation section at the bottom of your README in a `### Understanding the Code` section so it reads like developer documentation?
