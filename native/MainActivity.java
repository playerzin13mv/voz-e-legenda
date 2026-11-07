package com.vozelegenda.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaLibPlugin.class);
        super.onCreate(savedInstanceState);
        // servidor de arquivos do app (vídeos/áudios com suporte a "pular" e CORS)
        getBridge().getWebView().setWebViewClient(new MediaWebViewClient(getBridge()));
    }
}
