/* Camada de plataforma: fala com o Android (plugins) ou cai no navegador. */
(() => {
'use strict';

const Cap = window.Capacitor;
const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

function plugin(name) {
  try { return Cap.registerPlugin(name); } catch (e) { return null; }
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

window.Native = { isNative, MediaLib, Share, App, fileUrl, paths: { files: '', cache: '' } };
})();
