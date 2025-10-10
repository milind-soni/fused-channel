(function (global) {
  function fusedChannel(name = "fused-default") {
    const t = ("BroadcastChannel" in window)
      ? new BroadcastChannel(name)
      : new EventTarget();

    function publish(type, payload = {}, origin = "udf") {
      const msg = { type, payload, origin, channel: name, ts: Date.now() };
      if (t instanceof BroadcastChannel)
        t.postMessage(msg);
      else
        t.dispatchEvent(new CustomEvent(type, { detail: msg }));
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

    function close() {
      if (t.close) t.close();
    }

    return { publish, on, close };
  }

  // expose globally and as module export if available
  global.fusedChannel = fusedChannel;
  if (typeof module !== "undefined") module.exports = fusedChannel;
})(this);
