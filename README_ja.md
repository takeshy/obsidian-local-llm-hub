# Local LLM Hub for Obsidian

**会社のセキュリティポリシーでクラウド API が使えない。でも、AI によるノート自動整理・ワークフロー自動化を諦めたくない人へ。**

Local LLM Hub は、[Gemini Helper](https://github.com/takeshy/obsidian-gemini-helper) のワークフロー自動化・RAG・MCP 連携・エージェントスキルを、**完全ローカル環境**で実現します。Ollama、LM Studio、または AnythingLLM — あなたのデータは一切外に出ません。

![ワークフロー実行](docs/images/execute_workflow.png)

---

## なぜローカルなのか

すべてのデータがあなたのマシンに留まります。API キーがクラウドに送られることも、Vault の中身がアップロードされることもありません。プライバシーは「オプション」ではなく、**アーキテクチャそのもの**です。

| データ | 保存先 |
|--------|--------|
| チャット履歴 | Vault 内の Markdown ファイル |
| RAG インデックス | ワークスペースフォルダにローカル保存 |
| LLM リクエスト | `localhost` のみ（Ollama / LM Studio / AnythingLLM） |
| MCP サーバー | stdio 経由のローカル子プロセス |
| 暗号化ファイル | ローカルで暗号化/復号 |
| 編集履歴 | メモリ上（再起動でクリア） |

> 自宅では [Gemini Helper](https://github.com/takeshy/obsidian-gemini-helper) を使っているけど、仕事では使えない — そんなあなたのためのプラグインです。同じワークフローエンジン、同じ UX、クラウド依存ゼロ。

---

## ワークフロー自動化 — コア機能

やりたいことを自然言語で書くだけ。AI がワークフローを組み立てます。YAML の知識は不要です。

### AI でワークフロー & スキルを作成

![AI でワークフロー作成](docs/images/create_workflow.png)

1. **Workflow** タブを開く → **+ New (AI)** を選択
2. 説明を入力: *「現在のページをインフォグラフィックに変換して保存して」*
3. ワークフローではなくエージェントスキルを作成したい場合は **「エージェントスキルとして作成」** にチェック
4. **Generate** をクリック — 完成

ローカルの LLM だけでは力不足？ **Copy Prompt** をクリックして Claude / GPT / Gemini に貼り付け、レスポンスを貼り戻して **Apply** すれば OK です。

![外部 LLM でスキル作成](docs/images/create_skill_with_external_llm.png)

### AI でワークフローを修正

既存のワークフローを読み込み、**AI Modify** をクリック、変更内容を説明するだけ。実行履歴を参照してエラーのデバッグも可能です。

![AI でワークフロー修正](docs/images/modify_workflow.png)

### ビジュアルノードエディタ

12 カテゴリ・23 種類のノードタイプ:

| カテゴリ | ノード |
|----------|--------|
| 変数 | `variable`, `set` |
| 制御 | `if`, `while` |
| LLM | `command` |
| データ | `http`, `json` |
| ノート | `note`, `note-read`, `note-search`, `note-list`, `folder-list`, `open` |
| ファイル | `file-explorer`, `file-save` |
| プロンプト | `prompt-file`, `prompt-selection`, `dialog` |
| 合成 | `workflow`（サブワークフロー） |
| RAG | `rag-sync` |
| スクリプト | `script`（サンドボックス JavaScript） |
| 外部連携 | `obsidian-command` |
| ユーティリティ | `sleep` |

![ワークフローパネル](docs/images/workflow.png)

### イベントトリガー & ホットキー

- **イベントトリガー** — ファイルの作成 / 変更 / 削除 / 名前変更 / オープン時に自動実行
- **ホットキー対応** — 任意の名前付きワークフローにキーボードショートカットを割り当て
- **実行履歴** — 過去のワークフロー実行をステップごとに確認

完全なノードリファレンスは [WORKFLOW_NODES_ja.md](docs/WORKFLOW_NODES_ja.md) を参照してください。

---

## AI チャット

ローカル LLM とのストリーミングチャット。思考プロセス表示、ファイル添付、`@` メンションによる Vault ノート参照、複数セッション管理。

![RAG 付きチャット](docs/images/chat_with_rag.png)

### Vault ツール（Function Calling）

Function Calling 対応モデル（Qwen、Llama 3.1+、Mistral）で Vault を直接操作:

`read_note` · `create_note` · `update_note` · `rename_note` · `create_folder` · `search_notes` · `list_notes` · `list_folders` · `get_active_note` · `propose_edit` · `execute_javascript`

**All** / **No Search** / **Off** の 3 モードを入力エリアから切り替え。

![ツール設定](docs/images/chat_tool_setting.png)

### MCP サーバー

ローカル [MCP](https://modelcontextprotocol.io/) サーバーに接続して AI の機能を外部ツールで拡張。MCP ツールは Vault ツールとマージされ、Function Calling 経由でルーティングされます — すべて**ローカル子プロセス**として実行。

![MCP 付きチャット](docs/images/chat_with_mcp.png)

### RAG（ローカル埋め込み）

ローカルの埋め込みモデル（例: `nomic-embed-text`）で Vault をインデックス化。関連ノートがコンテキストとして自動的に含まれます。すべてローカルで計算・保存。

### エージェントスキル

`SKILL.md` ファイルで再利用可能な指示をシステムプロンプトに注入。会話ごとに有効化できます。スキルはワークフローを公開でき、AI がチャット中にツールとして実行できます。

スキルの作成もワークフローと同じ方法で — **+ New (AI)** を選択し、**「エージェントスキルとして作成」** にチェックを入れて説明を記述するだけ。AI が `SKILL.md` の指示とワークフローの両方を生成します。

![エージェントスキル](docs/images/skill.png)

詳細は [SKILLS_ja.md](docs/SKILLS_ja.md) を参照してください。

### スラッシュコマンド & 会話の圧縮

- `/` で呼び出すカスタムプロンプトテンプレート
- `/compact` で長い会話をコンテキストを保持したまま圧縮

### ファイル暗号化

機密ノートをパスワードで保護。暗号化ファイルは AI チャットのツールからは見えませんが、ワークフローからはパスワード入力で読み取り可能 — API キーや認証情報の保管に最適。

### 編集履歴

AI による変更の自動追跡、差分表示、ワンクリック復元。

---

## セットアップ

### 必要なもの

- [Ollama](https://ollama.com/)、[LM Studio](https://lmstudio.ai/)、または [AnythingLLM](https://anythingllm.com/)
- チャットモデル（例: `ollama pull qwen3.5:4b`）
- **RAG 使用時**: 埋め込みモデル（例: `ollama pull nomic-embed-text`）

### クイックスタート

1. LLM サーバーをインストール・起動
2. プラグイン設定 → フレームワーク（Ollama / LM Studio / AnythingLLM）を選択
3. サーバー URL を設定（デフォルト値あり）
4. チャットモデルを取得・選択
5. **接続確認**をクリック

![LLM 設定](docs/images/setting_llm.png)

### RAG セットアップ

1. 設定で RAG を有効化
2. 埋め込みモデルを取得・選択
3. 対象フォルダを設定（省略時は Vault 全体）
4. **同期**をクリックしてインデックスを構築

![RAG 設定](docs/images/setting_rag_and_command.png)

### MCP サーバーのセットアップ

1. 設定 → **MCP サーバー** → **サーバーを追加**
2. 設定: 名前、コマンド（例: `npx`）、引数、環境変数（任意）
3. オンに切り替え — stdio 経由で自動接続

![MCP & 暗号化設定](docs/images/setting_mcp_server_and_encryption.png)

### ワークスペース設定

![ワークスペース設定](docs/images/setting_workspace.png)

### 対応フレームワーク

| フレームワーク | チャットエンドポイント | ストリーミング | 思考 | Function Calling |
|----------------|------------------------|----------------|------|------------------|
| Ollama | `/api/chat`（ネイティブ） | リアルタイム | `message.thinking` フィールド | `tools` パラメータ |
| LM Studio | `/v1/chat/completions` | SSE | `<think>` タグ | `tools` パラメータ |
| AnythingLLM | `/v1/openai/chat/completions` | SSE | `<think>` タグ | `tools` パラメータ |

---

## インストール

### BRAT（推奨）
1. [BRAT](https://github.com/TfTHacker/obsidian42-brat) プラグインをインストール
2. BRAT 設定 → "Add Beta plugin"
3. `https://github.com/takeshy/obsidian-local-llm-hub` を入力
4. Community plugins 設定でプラグインを有効化

### 手動インストール
1. リリースから `main.js`、`manifest.json`、`styles.css` をダウンロード
2. `.obsidian/plugins/` に `local-llm-hub` フォルダを作成
3. ファイルをコピーして Obsidian 設定で有効化

### ソースからビルド
```bash
git clone https://github.com/takeshy/obsidian-local-llm-hub
cd obsidian-local-llm-hub
npm install
npm run build
```

---

## Gemini Helper との関係

このプラグインは [obsidian-gemini-helper](https://github.com/takeshy/obsidian-gemini-helper) の**ローカル専用版**です。同じワークフローエンジン、同じ UX パターンを、クラウド API が使えない環境向けに設計しました。

| | Gemini Helper | Local LLM Hub |
|---|---|---|
| LLM バックエンド | Google Gemini API / CLI | Ollama / LM Studio / AnythingLLM |
| データの送信先 | Google サーバー | `localhost` のみ |
| ワークフローエンジン | ✅ | ✅（同一アーキテクチャ） |
| RAG | Google File Search | ローカル埋め込み |
| MCP | ✅ | ✅（stdio のみ） |
| エージェントスキル | ✅ | ✅ |
| 画像生成 | ✅（Gemini） | — |
| Web 検索 | ✅（Google） | — |
| コスト | 無料 / 従量課金 | **永久無料**（自分のハードウェア） |

最先端のクラウドモデルが必要なら Gemini Helper。**プライバシーが譲れない条件なら Local LLM Hub**。
