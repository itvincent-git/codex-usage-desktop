# Codex Usage Desktop

> **Codex のトークンの使い道、残りの利用枠、リセット時刻を、ひとつのローカルデスクトップアプリで把握。**

**[Windows x64 版をダウンロード](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-windows-x64-setup.exe)** · **[Apple Silicon 版](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-arm64.dmg)** · **[Intel Mac 版](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-x64.dmg)** · [English README](README.md) · [中文说明](README_zh.md)

⭐ Codex Usage Desktop が役に立ったら、[プロジェクトに **Star** を付けて](https://github.com/itvincent-git/codex-usage-desktop)応援してください。

## Codex の利用枠がどこで消費されたか、もう迷わない

Codex を毎日使っているなら、こんな疑問を持ったことはありませんか？

- **5 時間枠や週間枠は、あとどれくらい残っている？**
- **利用枠はいつリセットされる？**
- **どのプロジェクトやセッションが最も多くトークンを使った？**
- **今日の使用量は昨日と比べてどう？**
- **トークン消費や推定コストが最も大きいモデルは？**
- **長い Codex セッションの中で、実際に何が起きていた？**

Codex Usage Desktop は、パソコン上にある Codex のセッションデータをわかりやすいネイティブダッシュボードにまとめ、こうした疑問に答えます。

**API キー不要。専用アカウント不要。セッションログのアップロードなし。インストールして起動するだけ。**

![Codex Usage Desktop ダッシュボード](docs/dashboard.jpg)

## できること

### 📊 Codex の使用状況をひと目で把握

JSONL ログを読み解かなくても、使用状況を確認できます。

確認できる情報：

- トークン合計と推定コスト
- 入力・出力・キャッシュのトークン使用量
- キャッシュヒット率
- 日別・月別の推移
- 1 日あたりの平均使用量
- 任意の期間の使用状況

Codex の使用量が増えているか、トークンが何に使われているかをすぐに把握できます。

### ⏱ 上限に達する前に、残りの利用枠を確認

作業中も、現在の Codex の利用枠を確認できます。

確認できる情報：

- リアルタイムの **5 時間枠**
- **週間枠または月間枠**
- 残りの利用枠
- リセット時刻とカウントダウン
- 利用可能なリセット回数
- 利用可能な場合の利用枠リセット予測

**macOS のメニューバーや Windows のシステムトレイ**にも利用枠の情報を表示できます。表示テキストやカウントダウンの単位をカスタマイズでき、ダッシュボードを開いたままにする必要はありません。

リアルタイムの利用枠取得には、ローカルの Codex の既存のログイン状態を使用します。

![macOS メニューバーに表示される Codex の利用枠とリセットまでのカウントダウン](docs/menubar.jpg)

### 🔍 トークンの消費元を特定

次の単位で使用量を確認できます。

- プロジェクト
- モデル
- 日
- 月
- セッション

**どのプロジェクト、モデル、セッションがトークンを消費したか**を確認し、使用量が増えた理由を把握できます。

![トークンの内訳と推定コストを確認できるプロジェクト使用量の詳細](docs/project-usage-detail.jpg)

### 💬 個々の Codex セッションを詳しく理解

集計グラフから個々のセッションに進み、数字の背景にある活動を確認できます。

タイトル、プロジェクト、モデルでセッションを検索し、開いて活動の詳細を確認できます。

![トークン使用量、推定コスト、利用枠の消費量を表示するセッション一覧](docs/session-detail-list.jpg)

ローカルログに記録されている内容に応じて、セッション画面には次の情報が表示されます。

- トークン使用量と推定コスト
- 5 時間枠・週間枠の推定消費量
- 残りの利用枠の変化
- コマンドとツールの実行内容
- Web 検索と検索結果
- パッチとコード差分
- 長時間実行されるコマンド
- サブエージェントの階層
- セッションリプレイのタイムライン

**Codex が何をしたか**と、**その作業でどれだけ利用枠を消費したか**の両方を理解できます。

![コマンド、ツールの実行内容、元の JSONL へのリンクを含むセッション詳細タイムライン](docs/session-detail.jpg)

### 🔄 利用枠のリセット状況を把握

Codex の利用枠やリセットの仕組みは、時間とともに変わることがあります。Codex Usage Desktop で、その変化を確認できます。

確認できる情報：

- 最新の公式トークンリセット告知
- 最近のリセットイベント
- 過去 30 日間のリセット告知履歴
- セッションログで観測された、日ごとの残りの利用枠の変化
- 利用可能な場合のリセット回数の詳細と有効期限

### 💻 毎日のデスクトップ利用に

必要なときにすぐ確認でき、作業の邪魔になりにくい設計です。

- macOS・Windows 向けネイティブアプリ
- macOS メニューバー / Windows システムトレイ
- ログイン時の自動起動
- アップデートの自動確認
- English・简体中文・日本語
- Windows での WSL 内の Codex セッション検出
- ライトテーマとダークテーマ

### 📤 使用量データをエクスポート

ほかのツールで分析したり、使用状況を共有したりしたいときに。

ダッシュボードで選択した期間のデータを、次の形式で出力できます。

- **Excel（`.xlsx`）**
- **Markdown（`.md`）**

## プライバシーを標準で保護

Codex のセッションには、機密性の高いプロンプト、コード、コマンド、プロジェクト情報が含まれることがあります。

Codex Usage Desktop は、これらのデータをパソコン内に保持します。

- セッションログは**ローカルで読み取り**
- アプリがセッションログを**アップロードすることはありません**
- OpenAI や LiteLLM の API キーは不要
- Codex Usage Desktop 専用アカウントは不要
- 集計データはローカルの SQLite データベースに保存
- **無料かつオープンソース**

あなたの Codex データは、あなたの手元に。リアルタイムの利用枠取得やその他のネットワークリクエストについては、[プライバシーとネットワークアクセス](#プライバシーとネットワークアクセス)をご覧ください。

## 設定不要ですぐに使える

すでに Codex CLI を使っていますか？ それなら、すぐに使用状況を確認できます。

1. Codex Usage Desktop をインストールします。
2. アプリを起動します。
3. 既存の Codex セッションが自動で検出され、インデックスが作成されます。
4. トークン、利用枠、プロジェクト、モデル、セッションの確認を始めましょう。

分析サーバーの構築も、データベースの設定も、API キーの入力も不要です。

**インストールするだけで使えます。**

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
