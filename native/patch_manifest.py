"""Ajusta o AndroidManifest.xml gerado pelo Capacitor: permissões de mídia e app travado na vertical."""
import re

PATH = "android/app/src/main/AndroidManifest.xml"

PERMS = [
    ("android.permission.READ_MEDIA_VIDEO", ""),
    ("android.permission.READ_MEDIA_AUDIO", ""),
    ("android.permission.READ_EXTERNAL_STORAGE", ' android:maxSdkVersion="32"'),
    ("android.permission.WRITE_EXTERNAL_STORAGE", ' android:maxSdkVersion="28"'),
]

s = open(PATH, encoding="utf-8").read()

lines = []
for name, extra in PERMS:
    if name not in s:
        lines.append('    <uses-permission android:name="%s"%s />' % (name, extra))
if lines:
    s = s.replace("<application", "\n".join(lines) + "\n\n    <application", 1)

if "android:screenOrientation" not in s:
    s = re.sub(r"<activity\b", '<activity android:screenOrientation="portrait"', s, count=1)

assert "READ_MEDIA_VIDEO" in s and 'screenOrientation="portrait"' in s, "patch do manifesto falhou"
open(PATH, "w", encoding="utf-8").write(s)
print("AndroidManifest.xml ajustado")
