# Voz e Legenda 2.0

App Android (vertical) que junta **vídeo de fundo + áudio da voz + legendas** e exporta em **.mp4**.

## O que tem
- **Vídeos**: lista dos seus projetos (miniatura, duração, nº de legendas). Salvos sozinhos; se o app fechar, você volta onde estava.
- **Mods**: importe pacotes `.zip` do Choicer Voicer (pacotes de voz e de estúdio) ou arquivos soltos. Toque num clipe para ouvir e use como voz ou como fundo num novo vídeo.
- **Ajustes**: formato padrão, legendas (tamanho, posição, cor, caixa), qualidade (540p/720p/1080p), FPS, volumes, limpeza de espaço.
- **Escolher arquivos dentro do app**: navegador com álbuns da galeria (Recentes, Todos, Download, Camera…), miniaturas, e “Outros locais…” para o seletor do Android.
- **Editor**: legendas em partes (manual ou “colar texto e sincronizar”), legendas só no editor ou também no vídeo exportado, formato vertical/horizontal.
- **Exportar .mp4**: grava em disco aos poucos (não estoura a memória), salva em **Filmes/VozELegenda** na galeria ou compartilha.

## Gerar / atualizar o APK pelo Termux
```bash
cd ~ && unzip -o ~/storage/downloads/voz-e-legenda.zip && cd voz-e-legenda
bash publicar.sh
gh run watch        # acompanha o build
```
Quando terminar: **Releases → APK mais recente** no GitHub, baixe e instale.

O APK usa uma chave de assinatura fixa (`native/debug.keystore`), então as próximas versões instalam **por cima**, sem desinstalar.
(Se o seu app instalado veio de uma versão anterior a esta, desinstale ele uma vez.)

## Estrutura
- `www/` — o app (HTML/CSS/JS).
- `native/MediaLibPlugin.java` — plugin Android: galeria por álbuns, copiar arquivos, descompactar mods, gravar e salvar vídeo.
- `native/patch_manifest.py` — permissões e trava na vertical.
- `.github/workflows/build-apk.yml` — compila o APK.
- `assets/` — ícone.
