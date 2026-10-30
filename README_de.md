# Codex Usage Desktop

> **Sehen Sie, wohin Ihre Codex-Tokens fließen, wie viel Kontingent noch verfügbar ist und wann Ihre Limits zurückgesetzt werden – in einer lokalen Desktop-App.**

**[Download für Windows x64](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-windows-x64-setup.exe)** · **[Apple Silicon](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-arm64.dmg)** · **[Intel Mac](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-x64.dmg)** · [English README](README.md) · [简体中文](README_zh.md) · [日本語](README_ja.md) · [繁體中文](README_zh-TW.md) · [한국어](README_ko.md)

⭐ Wenn Codex Usage Desktop für Sie hilfreich ist, geben Sie dem Projekt gerne einen [**Stern**](https://github.com/itvincent-git/codex-usage-desktop).

## Verstehen Sie Ihren Codex-Kontingentverbrauch

Wenn Sie Codex täglich verwenden, haben Sie sich vielleicht schon gefragt:

- **Wie viel von meinem 5-Stunden- oder Wochenlimit ist noch übrig?**
- **Wann wird mein Kontingent zurückgesetzt?**
- **Welches Projekt oder welche Sitzung hat die meisten Tokens verbraucht?**
- **Wie hoch ist mein heutiger Verbrauch im Vergleich zu gestern?**
- **Welche Modelle verursachen den höchsten Token-Verbrauch und die höchsten geschätzten Kosten?**
- **Wie viel 5-Stunden- und Wochenkontingent verbraucht jedes Modell?**
- **Was genau ist in einer langen Codex-Sitzung passiert?**

Codex Usage Desktop beantwortet diese Fragen mit einer übersichtlichen nativen Oberfläche, die die bereits auf Ihrem Computer vorhandenen Codex-Sitzungsdaten auswertet.

**Kein API-Schlüssel. Kein zusätzliches Konto. Kein Hochladen Ihrer Sitzungsprotokolle. Einfach installieren und öffnen.**

![Übersicht von Codex Usage Desktop](docs/dashboard.jpg)

## Funktionen

### 📊 Codex-Verbrauch auf einen Blick

Verstehen Sie Ihren Verbrauch, ohne JSONL-Protokolle durchsuchen zu müssen.

Angezeigt werden:

- Gesamte Tokens und geschätzte Kosten
- Eingabe-, Ausgabe- und Cache-Tokens
- Cache-Trefferquote
- Tägliche und monatliche Verläufe
- Durchschnittlicher Tagesverbrauch
- Eigene Zeiträume

Erkennen Sie schnell, ob Ihr Codex-Verbrauch steigt und wohin die Tokens fließen.

### ⏱ Limits im Blick behalten

Behalten Sie Ihr aktuelles Codex-Kontingent während der Arbeit im Blick.

Überwachen Sie:

- Aktuelle **5-Stunden-Limits**
- **Wochen- oder Monatslimits**
- Verbleibendes Kontingent
- Zurücksetzungszeiten und Countdowns
- Verfügbares Zurücksetzungsguthaben
- Prognosen zu Kontingentzurücksetzungen, sofern verfügbar

Limit-Informationen können auch direkt in der **macOS-Menüleiste oder im Windows-Infobereich** angezeigt werden. Texte und Countdown-Einheiten sind anpassbar, sodass die Übersicht nicht ständig geöffnet bleiben muss.

Die aktuellen Limits werden über Ihre bestehende lokale Codex-Anmeldung abgerufen.

![Codex-Kontingent und Zurücksetzungs-Countdowns in der macOS-Menüleiste](docs/menubar.jpg)

Die Menüleiste kann auch den heutigen Token-Verbrauch und die geschätzten Kosten anzeigen. Unter macOS öffnet ein Rechtsklick auf das Menüleisten-Widget ein kompaktes Fenster mit dem Fortschritt des 5-Stunden- und Wochenkontingents, Zurücksetzungszeiten, heutigen Tokens und geschätzten Kosten. Von dort können Sie das Hauptfenster öffnen oder die App beenden.

<img src="docs/menubar-menu.jpg" alt="macOS-Menüleistenfenster mit verbleibendem Kontingent, Zurücksetzungszeiten und heutigem Verbrauch" width="436" />

*Die Menüleisten-Screenshots enthalten beispielhafte Konto- und Verbrauchsdaten.*

### 🔍 Token-Verbrauch nachvollziehen

Schlüsseln Sie den Verbrauch auf nach:

- Projekt
- Modell
- Tag
- Monat
- Sitzung

Erkennen Sie, **welches Projekt, Modell oder welche Sitzung Ihre Tokens verbraucht hat**, und verstehen Sie die Ursachen Ihres Verbrauchs.

In der Projektansicht können Sie:

- Tägliche Token- und Kostenverläufe je Projekt nebeneinander vergleichen
- Eingaben ohne Cache, Eingaben aus dem Cache, Ausgaben und Cache-Trefferquoten sehen; Balken vergleichen Token-Summen und geschätzte Kosten über Projekte hinweg
- Nach Projektname, letzter Aktivität, Token-Verbrauch (gesamt, Eingabe, Cache oder Ausgabe) oder geschätzten Kosten auf- oder absteigend sortieren
- Codex-Projekte anhand von Namen und Kennzeichnungen erkennen, während Verzeichnispfade sichtbar bleiben
- Ein Projekt anklicken, um detaillierte Analysen und durchsuchbare, nach Tagen gruppierte Sitzungen zu öffnen, und anschließend die Aktivität einer Sitzung untersuchen

![Projektverbrauch mit täglichen Verläufen, Token-Zusammensetzung und geschätzten Kosten](docs/project-usage-detail.webp)

Für jedes Modell sehen Sie den geschätzten Verbrauch des 5-Stunden- und Wochenkontingents im gewählten Zeitraum, sowohl insgesamt als auch pro Million Tokens. Diese Schätzungen basieren auf Sitzungsaufnahmen mit nur einem Modell und können durch parallele Sitzungen beeinflusst werden.

![Geschätzter Modellverbrauch des 5-Stunden- und Wochenkontingents](docs/model-quota-consumption.webp)

### 💬 Einzelne Codex-Sitzungen verstehen

Untersuchen Sie neben den zusammengefassten Diagrammen auch die einzelnen Sitzungen hinter den Zahlen.

Suchen Sie nach Sitzungstitel, Projekt und Modell und öffnen Sie eine Sitzung, um deren Aktivität zu untersuchen.

![Sitzungsliste mit Token-Verbrauch, geschätzten Kosten und Kontingentverbrauch](docs/session-detail-list.jpg)

Je nach Inhalt der lokalen Protokolle können Sitzungsansichten Folgendes zeigen:

- Token-Verbrauch und geschätzte Kosten
- Geschätzten Verbrauch des 5-Stunden- und Wochenkontingents
- Änderungen des verbleibenden Kontingents
- Befehle und Werkzeugaktivität
- Websuchen und Ergebnisse
- Patches und Dateiänderungen
- Lange laufende Befehle
- Unteragentenhierarchie
- Zeitleiste zur Sitzungswiedergabe

So verstehen Sie sowohl, **was Codex getan hat**, als auch, **wie viel Verbrauch dabei entstanden ist**.

![Sitzungszeitleiste mit Befehlen, Werkzeugaktivität und Links zu JSONL-Rohdaten](docs/session-detail.jpg)

### 🔄 Kontingentzurücksetzungen verstehen

Das Verhalten der Codex-Kontingente kann sich ändern. Codex Usage Desktop macht diese Änderungen sichtbar.

Angezeigt werden:

- Die neueste offizielle Ankündigung zur Token-Zurücksetzung
- Kürzlich erfolgte Zurücksetzungen
- Ankündigungsverlauf der letzten 30 Tage
- Tägliche Änderungen des Kontingentstands aus Sitzungsprotokollen
- Details zum Zurücksetzungsguthaben und dessen Ablaufzeiten, sofern verfügbar

### 💻 Für den Desktop-Alltag entwickelt

Codex Usage Desktop fügt sich in Ihren Arbeitsablauf ein:

- Native App für macOS und Windows
- macOS-Menüleiste / Windows-Infobereich
- Start bei der Anmeldung
- Automatische Update-Prüfung
- English, 简体中文, 繁體中文, 日本語, 한국어 und Deutsch
- Erkennung von Codex-Sitzungen in Windows WSL
- Helles und dunkles Design

### 📤 Verbrauchsdaten exportieren

Sie möchten Ihren Verbrauch anderweitig analysieren oder teilen?

Exportieren Sie den gewählten Übersichtszeitraum als:

- **Excel (`.xlsx`)**
- **Markdown (`.md`)**

## Datenschutz als Standard

Codex-Sitzungen können sensible Anweisungen, Code, Befehle und Projektinformationen enthalten.

Codex Usage Desktop belässt diese Daten auf Ihrem Computer.

- Sitzungsprotokolle werden **lokal gelesen**
- Sitzungsprotokolle werden **niemals von der App hochgeladen**
- Kein OpenAI- oder LiteLLM-API-Schlüssel erforderlich
- Kein Codex-Usage-Desktop-Konto erforderlich
- Zusammengefasste Statistiken werden in einer lokalen SQLite-Datenbank gespeichert
- Das Projekt ist **kostenlos und Open Source**

Ihre Codex-Daten bleiben bei Ihnen. Einzelheiten zu aktuellen Limits und weiteren Netzwerkanfragen finden Sie unter [Datenschutz und Netzwerkzugriff](#datenschutz-und-netzwerkzugriff).

## Ohne Einrichtung starten

Sie verwenden bereits Codex CLI? Dann können Sie Ihren Verbrauch sofort erkunden.

1. Codex Usage Desktop installieren.
2. App öffnen.
3. Bestehende Codex-Sitzungen werden automatisch erkannt und indexiert.
4. Tokens, Limits, Projekte, Modelle und Sitzungen erkunden.

Kein Analyseserver muss bereitgestellt, keine Datenbank konfiguriert und kein API-Schlüssel eingefügt werden.

**Einfach installieren und verwenden.**

## Installation

### Windows 10/11 x64

[Laden Sie das aktuelle Windows-Installationsprogramm herunter](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-windows-x64-setup.exe), öffnen Sie es und folgen Sie den Anweisungen. Das NSIS-Installationsprogramm installiert für den aktuellen Benutzer; eine systemweite Installation ist nicht erforderlich.

> [!WARNING]
> Das Windows-Installationsprogramm ist noch nicht mit Authenticode signiert. Microsoft Defender SmartScreen kann daher eine Warnung zu einer unbekannten App anzeigen. Prüfen Sie vor dem Fortfahren, dass die Datei aus einem GitHub-Release dieses Repositorys stammt.

Die App verwendet zunächst Sitzungen unter `%USERPROFILE%\.codex`. Falls dort keine JSONL-Sitzungen vorhanden sind, prüft sie automatisch die Standard-WSL-Distribution und verwendet deren `$HOME/.codex`-Daten und Codex CLI. Native und WSL-Sitzungen werden nicht zusammengeführt, um doppelte Verbrauchssummen zu vermeiden.

### macOS

Wählen Sie die passende Version für Ihren Mac:

| Mac | Download |
| --- | --- |
| Apple Silicon (M1, M2, M3, M4 und neuer) | [Aktuelles ARM64-DMG herunterladen](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-arm64.dmg) |
| Intel | [Aktuelles x64-DMG herunterladen](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-x64.dmg) |

Öffnen Sie das DMG und verschieben Sie **Codex Usage Desktop** nach „Programme“. Sie können auch das [neueste Release und die Versionshinweise](https://github.com/itvincent-git/codex-usage-desktop/releases/latest) ansehen.

> [!NOTE]
> Die App umgeht macOS Gatekeeper nicht. Falls macOS den ersten Start blockiert, öffnen Sie **Systemeinstellungen → Datenschutz & Sicherheit** und erlauben Sie die App.

### Homebrew

Fügen Sie dieses Repository als Tap hinzu und installieren Sie das Cask:

```bash
brew tap itvincent-git/codex-usage-desktop https://github.com/itvincent-git/codex-usage-desktop
brew install --cask itvincent-git/codex-usage-desktop/codex-usage-desktop
```

Zum Aktualisieren:

```bash
brew update
brew upgrade --cask itvincent-git/codex-usage-desktop/codex-usage-desktop
```

Jedes Release aktualisiert die Cask-Version, die versionsspezifische Download-URL und die Prüfsummen für Apple Silicon und Intel. Ein normales `brew upgrade` berücksichtigt dieses Cask ebenfalls. Bestehende Homebrew-Installationen mit der Versionsangabe `latest` wechseln beim Upgrade zur nummerierten Version; eine Neuinstallation ist nicht erforderlich.

### Installation über das Terminal

Das Installationsskript erkennt Apple Silicon oder Intel, lädt das passende DMG herunter und kopiert die App nach `/Applications`:

```bash
curl -fsSL https://raw.githubusercontent.com/itvincent-git/codex-usage-desktop/main/scripts/install.sh | sh
```

Das Skript deaktiviert oder umgeht Gatekeeper nicht.

## Schnellstart

1. Verwenden Sie Codex CLI wie gewohnt, damit Sitzungsprotokolle unter `~/.codex` vorhanden sind (unter Windows: `%USERPROFILE%\.codex`).
2. Öffnen Sie Codex Usage Desktop. Die App scannt lokale Protokolle und erstellt einen lokalen SQLite-Index.
3. Wählen Sie einen Zeitraum oder öffnen Sie die Modell-, Projekt-, Tages-, Monats- oder Sitzungsansicht, um Ihren Verbrauch zu untersuchen.

Aktuelle Kontolimits erfordern eine authentifizierte lokale Codex-CLI-Sitzung. Führen Sie bei Bedarf `codex auth login` aus und aktualisieren Sie anschließend die Übersicht.

## Datenschutz und Netzwerkzugriff

Der Inhalt Ihrer Codex-Sitzungen ist sensibel. Die App ist darauf ausgelegt, ihn auf Ihrem Gerät zu belassen:

- Quelldateien unter `~/.codex` werden lokal gelesen und von der App niemals hochgeladen, geteilt oder verändert.
- In der App muss kein OpenAI- oder LiteLLM-API-Schlüssel eingegeben oder gespeichert werden.
- Zusammengefasste Verbrauchsdaten werden in einem SQLite-Cache im App-Datenverzeichnis des Betriebssystems gespeichert.
- Aktuelle Limits werden direkt von ChatGPT über Ihre bestehende lokale Codex-Authentifizierung abgerufen; dabei werden keine Sitzungsprotokolle übertragen.
- Netzwerkzugriff wird außerdem für öffentliche Schriftdateien, Modellpreise, Kontingentprognosen und Update-Prüfungen verwendet. Preise werden lokal zwischengespeichert. Diese Anfragen enthalten weder Ihre Sitzungsprotokolle noch Verbrauchsanalysen.

## Kompatibilität und aktuelle Einschränkungen

- Release-Pakete unterstützen macOS auf Apple Silicon und Intel sowie Windows 10/11 x64. Linux-Pakete werden derzeit nicht angeboten.
- Unter Windows wird nur die Standard-WSL-Distribution berücksichtigt, wenn keine nativen Sitzungen vorhanden sind; mehrere Distributionen werden nicht zusammengeführt.
- Verbrauchs- und Kostenwerte werden aus lokalen Codex-Protokollen berechnet; Kosten sind Schätzungen anhand der verfügbaren Modellpreise.
- Für unbekannte Modelle werden standardmäßig geschätzte Kosten von null angesetzt.
- Sitzungsdetails hängen von den Informationen im jeweiligen lokalen Codex-Protokoll ab.

## Erweiterte Optionen

- `CODEX_HOME`: Codex-Basisverzeichnis. Ein nicht leerer Wert hat Vorrang und deaktiviert die automatische Windows-/WSL-Erkennung.
- `CODEX_CLI_PATH`: Expliziter Pfad zur ausführbaren Codex CLI oder einem Wrapper (`codex`, `codex.exe` oder `codex.cmd`, je nach System).
- `CODEX_USAGE_TIMEZONE`: Zeitzone für die Tagesgruppierung; standardmäßig die Systemzeitzone, ersatzweise UTC.

## Entwicklung

Installieren Sie Node.js `>= 24`, `pnpm`, Rust, [sccache](https://github.com/mozilla/sccache#installation) (unter macOS mit `brew install sccache` oder mit `cargo install sccache --locked`) sowie die Tauri-v2-Systemabhängigkeiten und starten Sie anschließend die native Desktop-App:

```bash
pnpm install
pnpm tauri dev
```

Um den Ablauf zum Aktivieren eines 5-Stunden-Zeitfensters ohne Kontingentverbrauch zu prüfen, starten Sie den Debug-Build mit:

```bash
CODEX_USAGE_DEBUG_WINDOW_ACTIVATION=1 pnpm tauri dev
```

In diesem Modus liefert die Limit-Prüfung ein simuliertes inaktives Zeitfenster; dessen Start liefert eine simulierte erfolgreiche Aktivierung. In Release-Builds wird der Schalter ignoriert.

Prüfungen ausführen:

```bash
pnpm test
pnpm typecheck
cd src-tauri && cargo test
```

Installationspakete werden mit `pnpm tauri build` erstellt.

Rust-Builds verwenden sccache über `.cargo/config.toml`; inkrementelle Kompilierung ist deaktiviert. Mit `sccache --show-stats` können Sie Cache-Treffer prüfen. CI verwendet das GitHub-Actions-Cache-Backend, lokale Builds den lokalen Festplatten-Cache.

### Entwicklung der Release-Downloads

Führen Sie `pnpm downloads:trend` aus, um die kumulierten Download-Zahlen der drei Installationsdateien auf GitHub Releases abzurufen. Das Skript speichert eine Momentaufnahme in `.release-downloads.json` im Repository-Hauptverzeichnis. Regelmäßige Aufrufe zeigen den Zuwachs zwischen den Aufnahmen. Der erste Aufruf legt nur einen Ausgangswert fest; frühere tägliche Downloads lassen sich nicht rekonstruieren. Setzen Sie `GITHUB_TOKEN` oder `GH_TOKEN`, wenn Sie ein höheres GitHub-API-Anfragelimit benötigen.

Dies sind Download-Zahlen, keine Zahlen installierter Nutzer. Downloads des Windows-Installationsprogramms umfassen auch App-Updates.

## Sternverlauf

<a href="https://www.star-history.com/?repos=itvincent-git%2Fcodex-usage-desktop&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=itvincent-git/codex-usage-desktop&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=itvincent-git/codex-usage-desktop&type=date&legend=top-left" />
   <img alt="Diagramm des Sternverlaufs" src="https://api.star-history.com/chart?repos=itvincent-git/codex-usage-desktop&type=date&legend=top-left" />
 </picture>
</a>
