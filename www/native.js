/* Camada de plataforma: fala com o Android (plugins) ou cai no navegador. */
(() => {
'use strict';

const Cap = window.Capacitor;

function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }

// Detecta o Android de mais de um jeito (o "androidBridge" é criado pelo Capacitor no aplicativo instalado)
const platform = safe(() => (Cap && typeof Cap.getPlatform === 'function' ? Cap.getPlatform() : 'web'), 'web');
const isNative =
  !!safe(() => Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform(), false) ||
  platform === 'android' ||
  !!window.androidBridge;

/** Acha o plugin nativo: registerPlugin -> Capacitor.Plugins -> chamada direta à ponte. */
function plugin(name) {
  if (!Cap) return null;
  const viaRegister = safe(() => (typeof Cap.registerPlugin === 'function' ? Cap.registerPlugin(name) : null), null);
  if (viaRegister) return viaRegister;
  if (Cap.Plugins && Cap.Plugins[name]) return Cap.Plugins[name];
  if (typeof Cap.nativePromise === 'function' && typeof Proxy === 'function') {
    return new Proxy({}, {
      get: (_, method) => {
        if (method === 'addListener') {
          return (ev, cb) => Promise.resolve(typeof Cap.addListener === 'function' ? Cap.addListener(name, ev, cb) : null);
        }
        if (method === 'then') return undefined;
        return (opts) => Cap.nativePromise(name, String(method), opts || {});
      },
    });
  }
  return null;
}

const MediaLib = isNative ? plugin('MediaLib') : null;
const Share = isNative ? plugin('Share') : null;
const App = isNative ? plugin('App') : null;

/** Caminho local (do app) -> endereço que o <video>/<audio> consegue abrir.
 *  No Android, quem entrega o arquivo é o MediaWebViewClient (com Range e CORS). */
function fileUrl(path) {
  if (!path) return '';
  if (/^(blob:|https?:|data:)/.test(path)) return path;
  if (isNative) return '/_vlmedia_' + path.split('/').map(encodeURIComponent).join('/');
  return path;
}

/** Resumo para a tela de Ajustes (ajuda a saber se o plugin nativo carregou). */
function status() {
  return 'Plataforma: ' + (isNative ? 'Android (aplicativo)' : 'navegador') +
    ' · Plugin de arquivos: ' + (MediaLib ? 'ok' : 'NÃO carregou') +
    ' · Voltar/Compartilhar: ' + (App ? 'ok' : '—') + '/' + (Share ? 'ok' : '—');
}

window.Native = { isNative, MediaLib, Share, App, fileUrl, status, paths: { files: '', cache: '' } };
})();
