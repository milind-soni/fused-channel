(function (global) {
  if (!global.fusedChannel) {
    global.fusedChannel = function(name = "fused-default") {
      const t = ("BroadcastChannel" in window) ? new BroadcastChannel(name) : new EventTarget();
      function publish(type, payload = {}, origin = "udf") {
        const msg = { type, payload, origin, channel: name, ts: Date.now() };
        if (t instanceof BroadcastChannel) {
          t.postMessage(msg);
        } else {
          t.dispatchEvent(new CustomEvent(type, { detail: msg }));
          t.dispatchEvent(new CustomEvent("message", { detail: msg })); // ensure '*' listeners get messages
        }
      }
      function on(type, handler) {
        if (t instanceof BroadcastChannel) {
          t.addEventListener("message", e => {
            if (type === "*" || e.data?.type === type) handler(e.data);
          });
        } else {
          const eventName = (type === "*") ? "message" : type;
          t.addEventListener(eventName, e => {
            const msg = e.detail;
            if (type === "*" || msg?.type === type) handler(msg);
          });
        }
      }
      function close() { if (t.close) try { t.close(); } catch (_) {} }
      return { publish, on, close };
    };
  }

  global.enableMessaging = function({ source, channel, sender, type, on, off, getPayload }) {
    const ch = fusedChannel(channel);
    const handler = (...args) => ch.publish(type, getPayload(...args), sender);
    on(source, handler);
    window.addEventListener("beforeunload", () => ch.close && ch.close());
    return () => { try { off && off(source, handler); } catch (_) {} };
  };

  global.enableBoundsMessaging = function(map, channel, sender, event = "move") {
    const getPayload = () => {
      const b = map.getBounds();
      return { bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom: map.getZoom() };
    };
    const on  = (m, h) => { (m.loaded && m.loaded()) ? h() : m.once("load", h); m.on(event, h); };
    const off = (m, h) => m.off(event, h);
    return global.enableMessaging({ source: map, channel, sender, type: "bounds", on, off, getPayload });
  };

  global.enableBrushMessaging = function(view, channel, sender, signal = "brush") {
    const on  = (v, h) => v.addSignalListener(signal, h);
    const off = (v, h) => v.removeSignalListener(signal, h);
    const getPayload = (name, value) => ({ signal: name, extent: value });
    return global.enableMessaging({ source: view, channel, sender, type: "brush", on, off, getPayload });
  };

  global.enableButtonMessaging = function(el, channel, sender, basePayload = {}, event = "click") {
    const ch = fusedChannel(channel);
    const handler = () =>
      ch.publish("button", { id: el.id || null, event, ...basePayload }, sender);
    el.addEventListener(event, handler);
    window.addEventListener("beforeunload", () => ch.close && ch.close());
    return () => el.removeEventListener(event, handler);
  };

  global.enableMsgListener = function(channel, onMessage) {
    const ch = fusedChannel(channel);
    ch.on("*", m => {
      if (onMessage) return onMessage(m);
      document.body.textContent = JSON.stringify(m, null, 2);
    });
  };

  global.enableDropdownMessaging = function(el, channel, sender) {
    const ch = fusedChannel(channel);
    const handler = () => ch.publish("dropdown", { value: el.value }, sender);
    el.addEventListener("change", handler);
    if (el.value) handler();
    return () => el.removeEventListener("change", handler);
  };

  // 🔹 new helper for standardized receivers
  global.publishVars = (channel, sender, vars) => {
    fusedChannel(channel).publish("vars", { vars }, sender);
  };

})(this);
