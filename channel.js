(function (global) {
  if (!global.fusedChannel) {
    global.fusedChannel = function(name = "fused-default") {
      const t = ("BroadcastChannel" in window)
        ? new BroadcastChannel(name)
        : new EventTarget();
      function publish(type, payload = {}, origin = "udf") {
        const msg = { type, payload, origin, channel: name, ts: Date.now() };
        if (t instanceof BroadcastChannel) t.postMessage(msg);
        else t.dispatchEvent(new CustomEvent(type, { detail: msg }));
      }
      function on(type, handler) {
        if (t instanceof BroadcastChannel) {
          t.addEventListener("message", e => {
            if (e.data?.type === type) handler(e.data);
          });
        } else {
          t.addEventListener(type, e => handler(e.detail));
        }
      }
      function close() { if (t.close) t.close(); }
      return { publish, on, close };
    };
  }


  global.enableBoundsMessaging = function(map, channel, sender) {
    const ch = fusedChannel(channel);
    function sendBounds() {
      const b = map.getBounds();
      ch.publish('bounds', {
        bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        zoom: map.getZoom()
      }, sender);
    }
    if (map.loaded && map.loaded()) {
      sendBounds();
      map.on('move', sendBounds);   // 0-debounce
    } else {
      map.once('load', () => {
        sendBounds();
        map.on('move', sendBounds);
      });
    }
    window.addEventListener('beforeunload', () => ch.close && ch.close());
  };
})(this);
