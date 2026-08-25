# Codex Usage Desktop

> Codex のトークン、利用上限、コストの内訳を、セッションログを外部に送信することなく確認できます。

[![Release](https://img.shields.io/github/v/release/itvincent-git/codex-usage-desktop?label=release)](https://github.com/itvincent-git/codex-usage-desktop/releases/latest)
[![対応プラットフォーム：macOS / Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)](#インストール)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Local first](https://img.shields.io/badge/local--first-privacy-green.svg)](#プライバシーとネットワークアクセス)

**[Windows x64 版をダウンロード](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-windows-x64-setup.exe)** · **[Apple Silicon 版](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-arm64.dmg)** · **[Intel Mac 版](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-x64.dmg)** · [English README](README.md) · [中文说明](README_zh.md)

> [!IMPORTANT]
> ⭐ Codex Usage Desktop を気に入っていただけたら、[GitHub でリポジトリに Star を付けて](https://github.com/itvincent-git/codex-usage-desktop)、プロジェクトを応援してください。

![トークンコスト、推移、アカウント利用上限を表示する Codex Usage Desktop ダッシュボード](docs/screen_shot.jpg)

Codex Usage Desktop は、パソコン上にある Codex CLI のログを、わかりやすい使用状況ダッシュボードにまとめるアプリです。トークンとコストの推移、使用量の多いプロジェクトやモデル、個別セッションの詳細、アカウントの利用上限を、1 つのネイティブデスクトップアプリで確認できます。

- **ローカル処理が標準：** セッションログはパソコン上で読み取られ、アプリから外部へアップロードされることはありません。
- **API キーの設定不要：** インストールして起動するだけで、既存の Codex データをスキャンできます。
- **無料かつオープンソース：** アプリ専用アカウント、サブスクリプション、ホスティング型分析サービスは必要ありません。

## 確認できる情報

|                              | 機能                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **使用状況をひと目で把握**   | プリセットまたは任意の期間について、トークン合計、推定コスト、キャッシュヒット率、1 日平均、推移を確認できます。 |
| **コストの要因を特定**       | プロジェクト、モデル、日、月、個別の Codex セッションごとに使用量を確認できます。                           |
| **利用上限を事前に把握**     | 5 時間、週間、月間の利用上限、リセット時刻、利用可能なリセット回数、対応時には上限リセット予測を確認できます。 |
| **セッションの詳細を確認**   | セッション名、プロジェクト、モデルを検索し、各セッションの使用量とアクティビティの詳細を表示できます。       |
| **いつでも手軽に確認**       | メニューバーまたはシステムトレイへの任意表示、ログイン時の起動、英語・中国語 UI、アプリ内更新に対応します。   |
| **データをエクスポート**     | ダッシュボードで選択した期間を Excel（`.xlsx`）または Markdown（`.md`）形式で出力できます。                  |

## インストール

### Windows 10/11 x64

[最新の Windows セットアップ実行ファイルをダウンロード](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-windows-x64-setup.exe)し、ファイルを開いて画面の案内に従ってください。現在のユーザー向けの NSIS インストーラーであるため、システム全体へのインストールは必要ありません。

> [!WARNING]
> Windows インストーラーにはまだ Authenticode 署名がないため、Microsoft Defender SmartScreen により未認識のアプリとして警告される場合があります。続行する前に、このリポジトリの GitHub Release から取得したファイルであることを確認してください。

アプリはまず `%USERPROFILE%\.codex` にあるセッションを使用します。この場所に JSONL セッションがない場合は、既定の WSL ディストリビューションを自動的に確認し、その `$HOME/.codex` データと Codex CLI を使用します。使用量の重複集計を防ぐため、Windows ネイティブと WSL のセッションは統合されません。

### macOS

お使いの Mac に合ったビルドを選択してください。

| Mac                                        | ダウンロード                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple Silicon（M1、M2、M3、M4 以降）      | [最新の ARM64 DMG をダウンロード](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-arm64.dmg) |
| Intel                                      | [最新の x64 DMG をダウンロード](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-x64.dmg)     |

DMG を開き、**Codex Usage Desktop** を「アプリケーション」フォルダに移動してください。[最新リリースとリリースノート](https://github.com/itvincent-git/codex-usage-desktop/releases/latest)も確認できます。

> [!NOTE]
> このアプリは macOS の Gatekeeper を無効化・回避しません。初回起動時に macOS によってブロックされた場合は、**システム設定 → プライバシーとセキュリティ**を開き、アプリの起動を許可してください。

### ターミナルからインストール

インストーラーが Apple Silicon または Intel を判別し、対応する DMG をダウンロードして `/Applications` にアプリをコピーします。

```bash
curl -fsSL https://raw.githubusercontent.com/itvincent-git/codex-usage-desktop/main/scripts/install.sh | sh
```

このスクリプトは Gatekeeper を無効化・回避しません。

## クイックスタート

1. Codex CLI を通常どおり使用し、`~/.codex`（Windows では `%USERPROFILE%\.codex`）にセッションログが保存されていることを確認します。
2. Codex Usage Desktop を起動します。ローカルログがスキャンされ、ローカルの SQLite インデックスが作成されます。
3. 期間を選択するか、「モデル」「プロジェクト」「日別」「月別」「セッション」の各画面を開いて使用状況を確認します。

アカウントの利用上限をリアルタイムで確認するには、ローカルの Codex CLI で認証済みのセッションが必要です。必要に応じて `codex auth login` を実行し、ダッシュボードを更新してください。

## プライバシーとネットワークアクセス

Codex のセッション内容には機密情報が含まれる可能性があるため、このアプリはログをデバイス内に保持するよう設計されています。

- `~/.codex` 内のソースファイルはローカルでのみ読み取られ、アプリによってアップロード、共有、変更されることはありません。
- OpenAI または LiteLLM の API キーをアプリに入力したり、保存したりする必要はありません。
- 集計された使用量データは、OS のアプリデータディレクトリにある SQLite キャッシュへ保存されます。
- 利用上限は、既存のローカル Codex 認証情報を使用して ChatGPT から直接取得されます。その際、アプリがセッションログを送信することはありません。
- ネットワークアクセスは、公開フォントファイル、モデル料金、利用上限予測、更新確認にも使用されます。料金データはローカルにキャッシュされ、これらのリクエストにセッションログや使用状況の分析データは含まれません。

## 互換性と現在の制限

- リリースパッケージは Apple Silicon および Intel の macOS と、Windows 10/11 x64 に対応しています。現在、Linux パッケージは提供していません。
- Windows では、ネイティブセッションが空の場合に既定の WSL ディストリビューションのみを確認します。複数のディストリビューションは統合されません。
- 使用量とコストはローカルの Codex ログから算出されます。コストは取得可能なモデル料金に基づく推定値です。
- 不明なモデルの推定コストは、既定でゼロになります。
- セッションの詳細は、各ローカル Codex ログに含まれる情報によって異なります。

## 詳細設定

- `CODEX_HOME`：Codex のホームディレクトリ。空でない値が指定されている場合は最優先され、Windows/WSL の自動検出は無効になります。
- `CODEX_CLI_PATH`：Codex CLI の実行ファイルまたはラッパーを明示的に指定するパス（プラットフォームに応じて `codex`、`codex.exe`、`codex.cmd`）
- `CODEX_USAGE_TIMEZONE`：日別集計に使用するタイムゾーン。既定ではシステムのタイムゾーンを使用し、取得できない場合は UTC にフォールバックします。

## 開発

Codex Usage Desktop は React 19、Vite、Tauri v2、および Rust ネイティブの使用量処理パイプラインで構築されています。

Node.js `>= 24`、`pnpm`、Rust、Tauri v2 のシステム依存関係をインストールしてから、実際のデスクトップアプリを起動します。

```bash
pnpm install
pnpm tauri dev
```

各種チェックを実行します。

```bash
pnpm test
pnpm typecheck
cd src-tauri && cargo test
```

パッケージ版は `pnpm tauri build` でビルドできます。
