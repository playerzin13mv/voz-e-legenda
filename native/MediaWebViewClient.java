package com.vozelegenda.app;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * Serve os arquivos do próprio app (vídeos, áudios, mods) para o &lt;video&gt;/&lt;audio&gt;
 * em https://localhost/_vlmedia_/&lt;caminho&gt;, com suporte a Range (pular no vídeo)
 * e CORS (para o canvas não ficar "contaminado" e a exportação funcionar).
 * Só entrega arquivos dentro das pastas do próprio app.
 */
public class MediaWebViewClient extends BridgeWebViewClient {
    public static final String PREFIX = "/_vlmedia_";

    private final Context ctx;

    public MediaWebViewClient(Bridge bridge) {
        super(bridge);
        this.ctx = bridge.getContext();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url == null ? null : url.getPath();
        if (path != null && path.startsWith(PREFIX + "/")) {
            return serve(request, path.substring(PREFIX.length()));
        }
        return super.shouldInterceptRequest(view, request);
    }

    private boolean allowed(File f) {
        try {
            String p = f.getCanonicalPath();
            String a = ctx.getFilesDir().getCanonicalPath() + File.separator;
            String b = ctx.getCacheDir().getCanonicalPath() + File.separator;
            return p.startsWith(a) || p.startsWith(b);
        } catch (IOException e) {
            return false;
        }
    }

    private WebResourceResponse error(int code, String reason) {
        Map<String, String> h = new HashMap<String, String>();
        h.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("text/plain", "utf-8", code, reason, h, new ByteArrayInputStream(new byte[0]));
    }

    private WebResourceResponse serve(WebResourceRequest request, String filePath) {
        try {
            File f = new File(filePath);
            if (!allowed(f)) return error(403, "Forbidden");
            if (!f.isFile()) return error(404, "Not Found");

            long len = f.length();
            String mime = RangeSupport.mimeFor(f.getName());
            String rangeHeader = request.getRequestHeaders() == null ? null : request.getRequestHeaders().get("Range");
            long[] r = RangeSupport.parse(rangeHeader, len);

            Map<String, String> h = new HashMap<String, String>();
            h.put("Accept-Ranges", "bytes");
            h.put("Access-Control-Allow-Origin", "*");
            h.put("Cache-Control", "no-cache");

            if (r == null) {
                h.put("Content-Length", String.valueOf(len));
                return new WebResourceResponse(mime, null, 200, "OK", h, new FileInputStream(f));
            }
            if (r[0] < 0) {
                h.put("Content-Range", "bytes */" + len);
                return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", h, new ByteArrayInputStream(new byte[0]));
            }
            h.put("Content-Range", "bytes " + r[0] + "-" + r[1] + "/" + len);
            h.put("Content-Length", String.valueOf(r[1] - r[0] + 1));
            return new WebResourceResponse(mime, null, 206, "Partial Content", h, RangeSupport.open(f, r[0], r[1]));
        } catch (Exception e) {
            return error(500, "Error");
        }
    }
}
