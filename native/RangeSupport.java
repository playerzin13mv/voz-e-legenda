package com.vozelegenda.app;

import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;

/** Parte "pura" (sem Android) do servidor de mídia: leitura do cabeçalho Range e tipos de arquivo. */
public final class RangeSupport {
    private RangeSupport() { }

    /**
     * @return null se não há cabeçalho Range (responder o arquivo todo);
     *         {-1,-1} se o pedido é inválido/impossível (responder 416);
     *         {início, fim} (inclusive) caso contrário.
     */
    public static long[] parse(String header, long length) {
        if (header == null) return null;
        header = header.trim();
        if (header.isEmpty()) return null;
        if (!header.toLowerCase().startsWith("bytes=")) return new long[] { -1, -1 };
        String spec = header.substring(6).trim();
        int comma = spec.indexOf(',');
        if (comma >= 0) spec = spec.substring(0, comma).trim(); // só o primeiro intervalo
        int dash = spec.indexOf('-');
        if (dash < 0) return new long[] { -1, -1 };
        String a = spec.substring(0, dash).trim();
        String b = spec.substring(dash + 1).trim();
        try {
            long start;
            long end;
            if (a.isEmpty()) {              // bytes=-N  (últimos N bytes)
                if (b.isEmpty()) return new long[] { -1, -1 };
                long n = Long.parseLong(b);
                if (n <= 0) return new long[] { -1, -1 };
                start = Math.max(0, length - n);
                end = length - 1;
            } else {
                start = Long.parseLong(a);
                end = b.isEmpty() ? length - 1 : Long.parseLong(b);
            }
            if (length <= 0 || start < 0 || start >= length || end < start) return new long[] { -1, -1 };
            if (end > length - 1) end = length - 1;
            return new long[] { start, end };
        } catch (NumberFormatException e) {
            return new long[] { -1, -1 };
        }
    }

    /** Abre o arquivo já posicionado em [start] e que termina em [end] (inclusive). */
    public static InputStream open(File f, long start, long end) throws IOException {
        FileInputStream in = new FileInputStream(f);
        try {
            in.getChannel().position(start);
        } catch (IOException e) {
            in.close();
            throw e;
        }
        return new Bounded(in, end - start + 1);
    }

    private static final class Bounded extends FilterInputStream {
        private long left;

        Bounded(InputStream in, long len) {
            super(in);
            this.left = len;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = super.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = super.read(buf, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }

        @Override
        public long skip(long n) throws IOException {
            long s = super.skip(Math.min(n, left));
            if (s > 0) left -= s;
            return s;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(super.available(), left);
        }

        @Override
        public boolean markSupported() {
            return false;
        }
    }

    public static String mimeFor(String name) {
        String n = name == null ? "" : name.toLowerCase();
        int dot = n.lastIndexOf('.');
        String ext = dot >= 0 ? n.substring(dot + 1) : "";
        switch (ext) {
            case "mp4": case "m4v": return "video/mp4";
            case "webm": return "video/webm";
            case "ogv": return "video/ogg";
            case "mkv": return "video/x-matroska";
            case "mov": return "video/quicktime";
            case "3gp": return "video/3gpp";
            case "mp3": return "audio/mpeg";
            case "m4a": return "audio/mp4";
            case "aac": return "audio/aac";
            case "wav": return "audio/wav";
            case "ogg": case "oga": case "opus": return "audio/ogg";
            case "flac": return "audio/flac";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "json": return "application/json";
            case "txt": case "ini": return "text/plain";
            default: return "application/octet-stream";
        }
    }
}
