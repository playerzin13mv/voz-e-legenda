package com.vozelegenda.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Size;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Galeria do celular (vídeos/áudios por álbum), cópia para dentro do app,
 * descompactar mods, gravar o vídeo exportado em disco e salvar na galeria.
 */
@CapacitorPlugin(
    name = "MediaLib",
    permissions = {
        @Permission(alias = "media33", strings = { Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "media", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class MediaLibPlugin extends Plugin {

    private interface Task {
        void run(PluginCall call) throws Exception;
    }

    /** Roda em thread própria para não travar as outras chamadas. */
    private void async(final PluginCall call, final Task task) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    task.run(call);
                } catch (Throwable e) {
                    call.reject(String.valueOf(e.getMessage() != null ? e.getMessage() : e));
                }
            }
        }).start();
    }

    // ------------------------------------------------------------------ permissão

    private String permAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "media33" : "media";
    }

    @PluginMethod
    public void ensurePermission(PluginCall call) {
        if (getPermissionState(permAlias()) == PermissionState.GRANTED) {
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
        } else {
            requestPermissionForAlias(permAlias(), call, "permResult");
        }
    }

    @PermissionCallback
    private void permResult(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState(permAlias()) == PermissionState.GRANTED);
        call.resolve(r);
    }

    // ------------------------------------------------------------------ caminhos

    @PluginMethod
    public void getPaths(PluginCall call) {
        JSObject r = new JSObject();
        r.put("files", getContext().getFilesDir().getAbsolutePath());
        r.put("cache", getContext().getCacheDir().getAbsolutePath());
        call.resolve(r);
    }

    private boolean inside(File f) {
        try {
            String p = f.getCanonicalPath();
            String a = getContext().getFilesDir().getCanonicalPath();
            String b = getContext().getCacheDir().getCanonicalPath();
            return p.startsWith(a + File.separator) || p.startsWith(b + File.separator);
        } catch (IOException e) {
            return false;
        }
    }

    private static String sanitize(String name) {
        if (name == null) name = "arquivo";
        name = name.replace('\\', '/');
        int i = name.lastIndexOf('/');
        if (i >= 0) name = name.substring(i + 1);
        name = name.replaceAll("[^\\p{L}\\p{N}._ \\-()]", "_").trim();
        if (name.length() > 120) name = name.substring(name.length() - 120);
        if (name.isEmpty() || name.equals(".") || name.equals("..")) name = "arquivo";
        return name;
    }

    private static String safeSub(String s) {
        if (s == null) return "media";
        s = s.replace('\\', '/').replaceAll("\\.\\.+", "_").replaceAll("^/+", "");
        StringBuilder sb = new StringBuilder();
        for (String part : s.split("/")) {
            if (part.isEmpty()) continue;
            if (sb.length() > 0) sb.append('/');
            sb.append(sanitize(part));
        }
        return sb.length() == 0 ? "media" : sb.toString();
    }

    private static File uniqueFile(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        String base = name;
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            base = name.substring(0, dot);
            ext = name.substring(dot);
        }
        int n = 2;
        while (true) {
            f = new File(dir, base + " (" + n + ")" + ext);
            if (!f.exists()) return f;
            n++;
        }
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
        }
    }

    // ------------------------------------------------------------------ galeria

    private static class Row {
        long id;
        String name = "";
        String bucketId = "";
        String bucketName = "";
        long duration;
        long size;
        long date;
    }

    private Uri collection(String type) {
        if ("audio".equals(type)) return MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        return MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
    }

    private List<Row> query(String type, String onlyBucket) {
        ContentResolver cr = getContext().getContentResolver();
        boolean q = Build.VERSION.SDK_INT >= 29;
        String[] proj = q
            ? new String[] { "_id", "_display_name", "duration", "_size", "date_added", "bucket_id", "bucket_display_name" }
            : new String[] { "_id", "_display_name", "duration", "_size", "date_added", "_data" };
        List<Row> out = new ArrayList<Row>();
        Cursor c = cr.query(collection(type), proj, null, null, "date_added DESC");
        if (c == null) return out;
        try {
            while (c.moveToNext()) {
                Row r = new Row();
                r.id = c.getLong(0);
                String nm = c.getString(1);
                r.name = nm == null ? "" : nm;
                r.duration = c.getLong(2);
                r.size = c.getLong(3);
                r.date = c.getLong(4);
                if (q) {
                    String bid = c.getString(5);
                    String bn = c.getString(6);
                    r.bucketId = bid == null ? "" : bid;
                    r.bucketName = bn == null ? "" : bn;
                } else {
                    String p = c.getString(5);
                    File parent = p == null ? null : new File(p).getParentFile();
                    r.bucketId = parent == null ? "" : parent.getAbsolutePath();
                    r.bucketName = parent == null ? "" : parent.getName();
                }
                if (onlyBucket != null && !onlyBucket.equals(r.bucketId)) continue;
                out.add(r);
            }
        } finally {
            c.close();
        }
        return out;
    }

    @PluginMethod
    public void listAlbums(PluginCall call) {
        final String type = call.getString("type", "video");
        async(call, new Task() {
            @Override
            public void run(PluginCall pc) throws Exception {
                List<Row> rows = query(type, null);
                LinkedHashMap<String, String> names = new LinkedHashMap<String, String>();
                HashMap<String, Integer> counts = new HashMap<String, Integer>();
                for (Row r : rows) {
                    if (!names.containsKey(r.bucketId)) {
                        names.put(r.bucketId, r.bucketName);
                        counts.put(r.bucketId, 0);
                    }
                    counts.put(r.bucketId, counts.get(r.bucketId) + 1);
                }
                JSArray arr = new JSArray();
                for (Map.Entry<String, String> e : names.entrySet()) {
                    JSObject a = new JSObject();
                    a.put("id", e.getKey());
                    a.put("name", e.getValue());
                    a.put("count", counts.get(e.getKey()));
                    arr.put(a);
                }
                JSObject res = new JSObject();
                res.put("albums", arr);
                res.put("total", rows.size());
                pc.resolve(res);
            }
        });
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        final String type = call.getString("type", "video");
        final String bucket = call.getString("bucketId");
        final int offset = call.getInt("offset", 0);
        final int limit = call.getInt("limit", 150);
        async(call, new Task() {
            @Override
            public void run(PluginCall pc) throws Exception {
                List<Row> rows = query(type, bucket);
                JSArray arr = new JSArray();
                int end = Math.min(rows.size(), offset + limit);
                for (int i = offset; i < end; i++) {
                    Row r = rows.get(i);
                    JSObject o = new JSObject();
                    o.put("id", r.id);
                    o.put("uri", ContentUris.withAppendedId(collection(type), r.id).toString());
                    o.put("name", r.name);
                    o.put("duration", r.duration);
                    o.put("size", r.size);
                    o.put("date", r.date);
                    arr.put(o);
                }
                JSObject res = new JSObject();
                res.put("files", arr);
                res.put("total", rows.size());
                pc.resolve(res);
            }
        });
    }

    @PluginMethod
    public void thumb(PluginCall call) {
        final String uriStr = call.getString("uri");
        final String type = call.getString("type", "video");
        final int size = call.getInt("size", 200);
        async(call, new Task() {
            @Override
            public void run(PluginCall pc) throws Exception {
                Uri uri = Uri.parse(uriStr);
                Bitmap bm = null;
                if (Build.VERSION.SDK_INT >= 29) {
                    try {
                        bm = getContext().getContentResolver().loadThumbnail(uri, new Size(size, size), null);
                    } catch (Exception e1) {
                        bm = null;
                    }
                }
                if (bm == null && "video".equals(type)) {
                    MediaMetadataRetriever mmr = new MediaMetadataRetriever();
                    try {
                        mmr.setDataSource(getContext(), uri);
                        bm = mmr.getFrameAtTime(1000000);
                    } catch (Exception e2) {
                        bm = null;
                    } finally {
                        try {
                            mmr.release();
                        } catch (Exception e3) {
                            // ignora
                        }
                    }
                }
                JSObject res = new JSObject();
                if (bm != null) {
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    bm.compress(Bitmap.CompressFormat.JPEG, 70, bos);
                    res.put("data", "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
                }
                pc.resolve(res);
            }
        });
    }

    // ------------------------------------------------------------------ escolher documento (outros locais)

    private JSObject describe(Uri uri) {
        JSObject o = new JSObject();
        o.put("uri", uri.toString());
        String name = "arquivo";
        long size = 0;
        Cursor c = null;
        try {
            c = getContext().getContentResolver().query(uri, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int si = c.getColumnIndex(OpenableColumns.SIZE);
                if (ni >= 0 && c.getString(ni) != null) name = c.getString(ni);
                if (si >= 0) size = c.getLong(si);
            }
        } catch (Exception e) {
            // mantém padrão
        } finally {
            if (c != null) c.close();
        }
        o.put("name", name);
        o.put("size", size);
        return o;
    }

    @PluginMethod
    public void pickDocument(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        JSArray types = call.getArray("types");
        if (types != null && types.length() > 0) {
            String[] mimes = new String[types.length()];
            for (int k = 0; k < types.length(); k++) {
                mimes[k] = types.optString(k, "*/*");
            }
            i.putExtra(Intent.EXTRA_MIME_TYPES, mimes);
        }
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, call.getBoolean("multiple", false));
        startActivityForResult(call, i, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSArray files = new JSArray();
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            ClipData cd = data.getClipData();
            if (cd != null) {
                for (int k = 0; k < cd.getItemCount(); k++) {
                    files.put(describe(cd.getItemAt(k).getUri()));
                }
            } else if (data.getData() != null) {
                files.put(describe(data.getData()));
            }
        }
        JSObject res = new JSObject();
        res.put("files", files);
        call.resolve(res);
    }

    // ------------------------------------------------------------------ copiar / descompactar / listar / apagar

    @PluginMethod
    public void copyToApp(PluginCall call) {
        final String uriStr = call.getString("uri");
        final String sub = safeSub(call.getString("subdir", "media"));
        final String name = sanitize(call.getString("name", "arquivo"));
        async(call, new Task() {
            @Override
            public void run(PluginCall pc) throws Exception {
                Uri uri = Uri.parse(uriStr);
                File dir = new File(getContext().getFilesDir(), sub);
                dir.mkdirs();
                long srcSize = describe(uri).getLong("size");
                File exact = new File(dir, name);
                File dest;
                if (exact.exists() && srcSize > 0 && exact.length() == srcSize) {
                    dest = exact; // já copiado antes
                } else {
                    dest = uniqueFile(dir, name);
                    InputStream in = getContext().getContentResolver().openInputStream(uri);
                    if (in == null) throw new IOException("não consegui abrir o arquivo");
                    OutputStream out = new FileOutputStream(dest);
                    try {
                        copy(in, out);
                    } finally {
                        try { in.close(); } catch (IOException ignore) { }
                        out.close();
                    }
                }
                JSObject res = new JSObject();
                res.put("path", dest.getAbsolutePath());
                res.put("name", dest.getName());
                res.put("size", dest.length());
                pc.resolve(res);
            }
        });
    }

    @PluginMethod
    public void unzip(PluginCall call) {
        final String uriStr = call.getString("uri");
        final String modName = sanitize(call.getString("name", "mod"));
        async(call, new Task() {
            @Override
            public void run(PluginCall pc) throws Exception {
                File base = new File(getContext().getFilesDir(), "mods");
                base.mkdirs();
                File root = uniqueFile(base, modName);
                root.mkdirs();
                String rootCanon = root.getCanonicalPath() + File.separator;
                InputStream raw = getContext().getContentResolver().openInputStream(Uri.parse(uriStr));
                if (raw == null) throw new IOException("não consegui abrir o zip");
                int count = 0;
                ZipInputStream zin = new ZipInputStream(raw);
                try {
                    ZipEntry e;
                    while ((e = zin.getNextEntry()) != null) {
                        String nm = e.getName().replace('\\', '/');
                        if (nm.startsWith("__MACOSX/") || nm.endsWith(".DS_Store")) continue;
                        File out = new File(root, nm);
                        String canon = out.getCanonicalPath();
                        if (!(canon + File.separator).startsWith(rootCanon)) continue; // proteção contra zip malicioso
                        if (e.isDirectory()) {
                            out.mkdirs();
                            continue;
                        }
                        File parent = out.getParentFile();
                        if (parent != null) parent.mkdirs();
                        OutputStream os = new FileOutputStream(out);
                        try {
                            copy(zin, os);
                        } finally {
                            os.close();
                        }
                        count++;
                    }
                } finally {
                    zin.close();
                }
                JSObject res = new JSObject();
                res.put("path", root.getAbsolutePath());
                res.put("name", root.getName());
                res.put("files", count);
                pc.resolve(res);
            }
        });
    }

    private void walk(File dir, String rel, JSArray out, int[] budget) {
        File[] list = dir.listFiles();
        if (list == null) return;
        for (File f : list) {
            if (budget[0] <= 0) return;
            String r = rel.isEmpty() ? f.getName() : rel + "/" + f.getName();
            if (f.isDirectory()) {
                walk(f, r, out, budget);
            } else {
                JSObject o = new JSObject();
                o.put("path", f.getAbsolutePath());
                o.put("rel", r);
                o.put("name", f.getName());
                o.put("size", f.length());
                out.put(o);
                budget[0]--;
            }
        }
    }

    @PluginMethod
    public void listDir(PluginCall call) {
        final File dir = new File(call.getString("path", ""));
        if (!inside(dir)) {
            call.reject("caminho inválido");
            return;
        }
        async(call, new Task() {
            @Override
            public void run(PluginCall pc) throws Exception {
                JSArray arr = new JSArray();
                long total = 0;
                walk(dir, "", arr, new int[] { 5000 });
                for (int k = 0; k < arr.length(); k++) {
                    total += arr.getJSONObject(k).optLong("size", 0);
                }
                JSObject res = new JSObject();
                res.put("files", arr);
                res.put("size", total);
                pc.resolve(res);
            }
        });
    }

    private static void deleteRecursive(File f) {
        if (f.isDirectory()) {
            File[] list = f.listFiles();
            if (list != null) for (File c : list) deleteRecursive(c);
        }
        f.delete();
    }

    @PluginMethod
    public void remove(PluginCall call) {
        final File f = new File(call.getString("path", ""));
        if (!inside(f)) {
            call.reject("caminho inválido");
            return;
        }
        async(call, new Task() {
            @Override
            public void run(PluginCall pc) throws Exception {
                deleteRecursive(f);
                pc.resolve();
            }
        });
    }

    // ------------------------------------------------------------------ exportação em disco

    /** Anexa um pedaço (base64) ao vídeo que está sendo gravado, para não estourar a memória. */
    @PluginMethod
    public void appendChunk(PluginCall call) {
        try {
            String name = sanitize(call.getString("name", "video.mp4"));
            String data = call.getString("data", "");
            boolean reset = call.getBoolean("reset", false);
            String where = call.getString("dir", "cache");
            String sub = call.getString("subdir", "");
            File base = "files".equals(where) ? getContext().getFilesDir() : getContext().getCacheDir();
            File dir;
            if ("files".equals(where)) {
                // gravações de dublagem: dentro de files/takes/...
                String clean = sub.replace("..", "").replaceAll("^/+", "");
                dir = new File(base, clean.length() > 0 ? clean : "takes");
            } else {
                dir = new File(base, "exports");
            }
            dir.mkdirs();
            File f = new File(dir, name);
            if (!inside(f)) { call.reject("caminho não permitido"); return; }
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            FileOutputStream os = new FileOutputStream(f, !reset);
            try {
                os.write(bytes);
            } finally {
                os.close();
            }
            JSObject res = new JSObject();
            res.put("path", f.getAbsolutePath());
            res.put("size", f.length());
            call.resolve(res);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage() != null ? e.getMessage() : e));
        }
    }

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        final File src = new File(call.getString("path", ""));
        final String name = sanitize(call.getString("name", "video.mp4"));
        final String mime = call.getString("mime", "video/mp4");
        if (!inside(src) || !src.exists()) {
            call.reject("arquivo não encontrado");
            return;
        }
        async(call, new Task() {
            @Override
            public void run(PluginCall pc) throws Exception {
                JSObject res = new JSObject();
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentResolver cr = getContext().getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/VozELegenda");
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri uri = cr.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IOException("não consegui criar o arquivo na galeria");
                    OutputStream os = cr.openOutputStream(uri);
                    if (os == null) throw new IOException("não consegui gravar na galeria");
                    InputStream in = new FileInputStream(src);
                    try {
                        copy(in, os);
                    } finally {
                        in.close();
                        os.close();
                    }
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    cr.update(uri, done, null, null);
                    res.put("uri", uri.toString());
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "VozELegenda");
                    dir.mkdirs();
                    File dest = uniqueFile(dir, name);
                    InputStream in = new FileInputStream(src);
                    OutputStream os = new FileOutputStream(dest);
                    try {
                        copy(in, os);
                    } finally {
                        in.close();
                        os.close();
                    }
                    MediaScannerConnection.scanFile(getContext(), new String[] { dest.getAbsolutePath() }, new String[] { mime }, null);
                    res.put("uri", dest.getAbsolutePath());
                }
                res.put("where", "Filmes/VozELegenda");
                pc.resolve(res);
            }
        });
    }
}
