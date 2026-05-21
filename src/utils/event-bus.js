/**
 * EventBus - Lightweight in-process event bus
 * Supports multiple listeners per event with error isolation.
 * One listener throwing does not break others.
 */
class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('EventBus listener must be a function');
    }
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(listener);
  }

  off(event, listener) {
    const list = this._listeners.get(event);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx >= 0) {
      list.splice(idx, 1);
    }
  }

  emit(event, ...args) {
    const list = this._listeners.get(event);
    if (!list || list.length === 0) return;
    for (const listener of list) {
      try {
        listener(...args);
      } catch (e) {
        console.error(`[EventBus] Listener for "${event}" failed:`, e.message);
      }
    }
  }

  async emitAsync(event, ...args) {
    const list = this._listeners.get(event);
    if (!list || list.length === 0) return;
    for (const listener of list) {
      try {
        await listener(...args);
      } catch (e) {
        console.error(`[EventBus] Async listener for "${event}" failed:`, e.message);
      }
    }
  }

  listenerCount(event) {
    const list = this._listeners.get(event);
    return list ? list.length : 0;
  }
}

module.exports = { EventBus };
