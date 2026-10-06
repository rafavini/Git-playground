/* Storage — camada fina sobre o localStorage.
   Todas as chaves ficam sob um prefixo. Para ligar um backend no futuro,
   basta trocar a implementação deste módulo mantendo a mesma interface. */
const Storage = (() => {
  const PREFIX = 'gitplayground.v1.';
  const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
  return {
    get(key, fallback = null) {
      return safe(() => {
        const raw = localStorage.getItem(PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      }, fallback);
    },
    set(key, value) {
      return safe(() => { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }, false);
    },
    remove(key) { safe(() => localStorage.removeItem(PREFIX + key)); },
    clearAll() {
      safe(() => {
        Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k));
      });
    }
  };
})();
