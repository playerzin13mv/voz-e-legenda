/* Armazenamento simples e seguro (localStorage com try/catch). */
(() => {
'use strict';

const P = 'vl.';
let warned = false;

const Store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(P + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try {
      localStorage.setItem(P + key, JSON.stringify(value));
      return true;
    } catch (e) {
      if (!warned) { warned = true; console.warn('Sem espaço para salvar', e); }
      return false;
    }
  },
  del(key) {
    try { localStorage.removeItem(P + key); } catch (e) { /* ignora */ }
  },
};

window.Store = Store;
})();
