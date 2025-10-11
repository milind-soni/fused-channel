(function (global) {
  if (!global.fusedChannel) {
    global.fusedChannel = function(name = "fused-default") {
      const t = ("BroadcastChannel" in window) ? new BroadcastChannel(name) : new EventTarget();
      function publish(type, payload = {}, origin = "udf") {
        const msg = { type, payload, origin, channel: name, ts: Date.now() };
        if (t instanceof BroadcastChannel) t.postMessage(msg);
        else t.dispatchEvent(new CustomEvent(type, { detail: msg }));
      }
      function on(type, handler) {
        if (t instanceof BroadcastChannel) {
          t.addEventListener("message", e => { if (e.data?.type === type) handler(e.data); });
        } else {
          t.addEventListener(type, e => handler(e.detail));
        }
      }
      function close() { if (t.close) t.close(); }
      return { publish, on, close };
    };
  }

  global.enableMessaging = function({ source, channel, sender, type, on, off, getPayload }) {
    const ch = fusedChannel(channel);
    const handler = (...args) => ch.publish(type, getPayload(...args), sender);
    on(source, handler);
    window.addEventListener('beforeunload', () => ch.close && ch.close());
    return () => { try { off && off(source, handler); } catch (_) {} };
  };

  global.enableBoundsMessaging = function(map, channel, sender, event = 'move') {
    const getPayload = () => {
      const b = map.getBounds();
      return { bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom: map.getZoom() };
    };
    const on  = (m, h) => { (m.loaded && m.loaded()) ? h() : m.once('load', h); m.on(event, h); };
    const off = (m, h) => m.off(event, h);
    return global.enableMessaging({ source: map, channel, sender, type: 'bounds', on, off, getPayload });
  };

  global.enableBrushMessaging = function(view, channel, sender, signal = 'brush') {
    const on  = (v, h) => v.addSignalListener(signal, h);
    const off = (v, h) => v.removeSignalListener(signal, h);
    const getPayload = (name, value) => ({ signal: name, extent: value });
    return global.enableMessaging({ source: view, channel, sender, type: 'brush', on, off, getPayload });
  };

  global.enableButtonMessaging = function(el, channel, sender, event = 'click', basePayload = {}) {
    const on  = (e, h) => e.addEventListener(event, h);
    const off = (e, h) => e.removeEventListener(event, h);
    const getPayload = (ev) => ({ id: el.id || null, event, ...basePayload });
    return global.enableMessaging({ source: el, channel, sender, type: 'button', on, off, getPayload });
  };
  
  global.enableMsgListener = function(channel, onMessage) {
    const ch = fusedChannel(channel);
    ch.on('message', m => onMessage ? onMessage(m) : (
      document.getElementById('out').textContent = JSON.stringify(m, null, 2)
    ));
  };

})(this);
