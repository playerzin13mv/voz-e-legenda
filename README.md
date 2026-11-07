# Voz e Legenda

App Android (vertical) que junta **vídeo de fundo + áudio da voz + legendas** e exporta em **.mp4**.

## Como usar o app
1. Escolha o vídeo de fundo e o áudio da voz.
2. Escolha o formato (vertical ou horizontal).
3. No editor, crie as legendas:
   - **＋ Legenda aqui**: cria uma legenda no ponto atual.
   - **⚡ Colar texto e sincronizar**: cole o texto (uma parte por linha) e toque em *Próxima* quando cada frase começar na voz.
4. Ajustes: mostrar legendas só no editor ou também no vídeo exportado, volume do fundo e da voz.
5. **Exportar .mp4** (a gravação roda em tempo real: dura o tempo do áudio; deixe o app aberto).

## Gerar o APK pelo Termux
```bash
termux-setup-storage            # uma vez, para acessar os downloads
pkg install -y git gh unzip
gh auth login                   # se ainda não estiver logado
cd ~ && unzip ~/storage/downloads/voz-e-legenda.zip && cd voz-e-legenda
bash publicar.sh                # cria o repositório e envia
```
O GitHub Actions compila sozinho. Em ~5–10 min o APK aparece em **Releases → APK mais recente**.
Baixe no celular, abra e instale (permita “instalar apps desconhecidos” para o navegador).

## Mudar nome / ícone
- Nome: `capacitor.config.json` (`appName`).
- Ícone: troque os PNGs de 1024×1024 em `assets/` (`icon-only`, `icon-foreground`, `icon-background`).

## Próximos passos possíveis
- Legenda automática (Whisper offline).
- Estilos de legenda (cor, fonte, posição).
- Salvar projeto para continuar depois.
