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
          t.dispatchEvent(new CustomEvent('message', { detail: msg }));
        }
      }
      function on(type, handler) {
        if (t instanceof BroadcastChannel) {
          t.addEventListener("message", e => { if (type === '*' || e.data?.type === type) handler(e.data); });
        } else {
          const eventName = (type === '*') ? 'message' : type;
          t.addEventListener(eventName, e => {
            const msg = e.detail;
            if (type === '*' || msg?.type === type) handler(msg);
          });
        }
      }
      function close() { if (t.close) try { t.close(); } catch (_) {} }
      return { publish, on, close };
    };
  }

  function rafDebounce(fn) {
    let ticking = false;
    return function(...args) {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; fn.apply(this, args); });
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
    const on  = (m, h) => {
      const start = () => { h(); m.on(event, rafDebounce(h)); };
      (m.loaded && m.loaded()) ? start() : m.once('load', start);
    };
    const off = (m, h) => m.off(event, h);
    return global.enableMessaging({ source: map, channel, sender, type: 'bounds', on, off, getPayload });
  };

  global.enableBrushMessaging = function(view, channel, sender, signal = 'brush') {
    const on  = (v, h) => v.addSignalListener(signal, h);
    const off = (v, h) => v.removeSignalListener(signal, h);
    const getPayload = (name, value) => ({ signal: name, extent: value });
    return global.enableMessaging({ source: view, channel, sender, type: 'brush', on, off, getPayload });
  };

  global.enableButtonMessaging = function(el, channel, sender, basePayload = {}, event = 'click') {
    const ch = fusedChannel(channel);
    const handler = () => ch.publish('button', { id: el.id || null, event, ...basePayload }, sender);
    el.addEventListener(event, handler);
    window.addEventListener('beforeunload', () => ch.close && ch.close());
    return () => el.removeEventListener(event, handler);
  };

  global.enableMsgListener = function(channel, onMessage) {
    const ch = fusedChannel(channel);
    ch.on('*', m => {
      if (onMessage) return onMessage(m);
      document.body.textContent = JSON.stringify(m, null, 2);
    });
  };

  global.enableDropdownMessaging = function(el, channel, sender) {
    const ch = fusedChannel(channel);
    const handler = () => ch.publish('dropdown', { value: el.value }, sender);
    el.addEventListener('change', handler);
    if (el.value) handler();
    return () => el.removeEventListener('change', handler);
  };

  global.enableDrawMessaging = function(map, draw, channel, sender, opts = {}) {
    const {
      eventTypes = ['draw.create','draw.update','draw.delete','draw.combine','draw.uncombine'],
      includeBounds = false,
      initialEmit = true
    } = opts;

    const getPayload = () => {
      const payload = { geojson: draw.getAll() };
      if (includeBounds && map && map.getBounds) {
        const b = map.getBounds();
        payload.bounds = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
        payload.zoom = map.getZoom();
      }
      return payload;
    };

    const on  = (m, h) => {
      const start = () => {
        if (initialEmit) h();
        eventTypes.forEach(ev => m.on(ev, rafDebounce(h)));
      };
      (m.loaded && m.loaded()) ? start() : m.once('load', start);
    };
    const off = (m, h) => eventTypes.forEach(ev => m.off(ev, h));

    return global.enableMessaging({ source: map, channel, sender, type: 'shape', on, off, getPayload });
  };
})(this);
