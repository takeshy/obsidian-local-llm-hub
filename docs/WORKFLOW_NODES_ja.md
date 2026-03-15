# ワークフローノードリファレンス

このドキュメントはすべてのワークフローノードタイプの詳細仕様を提供します。ほとんどのユーザーは **これらの詳細を学ぶ必要はありません** — やりたいことを自然言語で記述するだけで、AI がワークフローを作成・修正します。

## ノードタイプ一覧

| カテゴリ | ノード | 説明 |
|----------|--------|------|
| 変数 | `variable`, `set` | 変数の宣言と更新 |
| 制御 | `if`, `while` | 条件分岐とループ |
| LLM | `command` | ローカル LLM でプロンプトを実行 |
| データ | `http`, `json` | HTTP リクエストと JSON パース |
| ノート | `note`, `note-read`, `note-search`, `note-list`, `folder-list`, `open` | Vault 操作 |
| ファイル | `file-explorer`, `file-save` | ファイル選択と保存（画像、PDF 等） |
| プロンプト | `prompt-file`, `prompt-selection`, `dialog` | ユーザー入力ダイアログ |
| 合成 | `workflow` | 別のワークフローをサブワークフローとして実行 |
| RAG | `rag-sync` | ノートを RAG ストアに同期 |
| 外部 | `obsidian-command` | Obsidian コマンドを実行 |
| スクリプト | `script` | サンドボックス化された iframe で JavaScript を実行 |
| ユーティリティ | `sleep` | ワークフロー実行を一時停止 |

---

## ワークフローオプション

`options` セクションでワークフローの動作を制御できます:

```yaml
name: My Workflow
options:
  showProgress: false  # 実行進捗モーダルを非表示（デフォルト: true）
nodes:
  - id: step1
    type: command
    ...
```

| オプション | 型 | デフォルト | 説明 |
|------------|------|-----------|------|
| `showProgress` | boolean | `true` | ホットキーまたはワークフローリストから実行時に進捗モーダルを表示 |

**注意:** `showProgress` オプションはホットキーまたはワークフローリストからの実行にのみ影響します。ビジュアルワークフローパネルでは常に進捗が表示されます。

---

## ノードリファレンス

### command

設定済みのローカルモデル（Ollama または LM Studio）で LLM プロンプトを実行します。

```yaml
- id: analyze
  type: command
  prompt: "このテキストを要約してください:\n\n{{content}}"
  saveTo: result
```

| プロパティ | 説明 |
|------------|------|
| `prompt` | LLM に送信するプロンプト（必須） |
| `attachments` | FileExplorerData を含む変数名のカンマ区切りリスト（`file-explorer` ノードから） |
| `saveTo` | テキスト応答を格納する変数名 |

command ノードはプラグイン設定で構成されたモデルを使用します。思考内容表示付きのストリーミング応答に対応しています。

### note

ノートファイルにコンテンツを書き込みます。

```yaml
- id: save
  type: note
  path: "output/{{filename}}.md"
  content: "{{result}}"
  mode: overwrite
  confirm: true
```

| プロパティ | 説明 |
|------------|------|
| `path` | ファイルパス（必須） |
| `content` | 書き込む内容 |
| `mode` | `overwrite`（デフォルト）、`append`、または `create`（既存の場合スキップ） |
| `confirm` | `true`（デフォルト）で確認ダイアログ表示、`false` で即座に書き込み |
| `history` | `true`（デフォルト、グローバル設定に従う）で編集履歴に保存、`false` でこの書き込みの履歴を無効化 |

### note-read

ノートファイルからコンテンツを読み取ります。

```yaml
- id: read
  type: note-read
  path: "notes/config.md"
  saveTo: content
```

| プロパティ | 説明 |
|------------|------|
| `path` | 読み取るファイルパス（必須） |
| `saveTo` | ファイル内容を格納する変数名（必須） |

**暗号化ファイル対応:**

対象ファイルが暗号化されている場合（プラグインの暗号化機能経由）、ワークフローは自動的に:
1. 現在のセッションでパスワードがキャッシュ済みか確認
2. キャッシュされていない場合、ユーザーにパスワード入力を要求
3. ファイル内容を復号して変数に格納
4. 以降の読み取りのためにパスワードをキャッシュ（同じ Obsidian セッション内）

一度パスワードを入力すれば、Obsidian を再起動するまで他の暗号化ファイルの読み取りでも再入力は不要です。

**例: 暗号化ファイルから API キーを読み取り外部 API を呼び出す**

```yaml
name: Call API with encrypted key
nodes:
  - id: read-key
    type: note-read
    path: "secrets/api-key.md"
    saveTo: apiKey
    next: call-api

  - id: call-api
    type: http
    url: "https://api.example.com/data"
    method: GET
    headers: '{"Authorization": "Bearer {{apiKey}}"}'
    saveTo: response
    next: show-result

  - id: show-result
    type: dialog
    title: API Response
    message: "{{response}}"
    markdown: true
    button1: OK
```

> **ヒント:** API キーなどの機密データは暗号化ファイルに保存してください。コマンドパレットの「ファイルを暗号化」コマンドで、秘密情報を含むファイルを暗号化できます。

### note-list

フィルタリングとソートでノートを一覧表示します。

```yaml
- id: list
  type: note-list
  folder: "Projects"
  recursive: true
  tags: "todo, project"
  tagMatch: all
  createdWithin: "7d"
  modifiedWithin: "24h"
  sortBy: modified
  sortOrder: desc
  limit: 20
  saveTo: noteList
```

| プロパティ | 説明 |
|------------|------|
| `folder` | フォルダパス（空で Vault 全体） |
| `recursive` | `true` でサブフォルダを含む、`false`（デフォルト）で直下のみ |
| `tags` | フィルタするタグのカンマ区切り（`#` あり/なし） |
| `tagMatch` | `any`（デフォルト）または `all` でタグの一致条件 |
| `createdWithin` | 作成時刻でフィルタ: `30m`、`24h`、`7d` |
| `modifiedWithin` | 更新時刻でフィルタ |
| `sortBy` | `created`、`modified`、または `name` |
| `sortOrder` | `asc` または `desc`（デフォルト） |
| `limit` | 最大結果数（デフォルト: 50） |
| `saveTo` | 結果を格納する変数 |

**出力形式:**
```json
{
  "count": 5,
  "totalCount": 12,
  "hasMore": true,
  "notes": [
    {"name": "Note1", "path": "folder/Note1.md", "created": 1234567890, "modified": 1234567900, "tags": ["#todo"]}
  ]
}
```

### note-search

ノートを名前または内容で検索します。

```yaml
- id: search
  type: note-search
  query: "{{searchTerm}}"
  searchContent: "true"
  limit: "20"
  saveTo: searchResults
```

| プロパティ | 説明 |
|------------|------|
| `query` | 検索クエリ文字列（必須、`{{variables}}` 対応） |
| `searchContent` | `true` でファイル内容を検索、`false`（デフォルト）でファイル名のみ |
| `limit` | 最大結果数（デフォルト: 10） |
| `saveTo` | 結果を格納する変数（必須） |

**出力形式:**
```json
{
  "count": 3,
  "results": [
    {"name": "Note1", "path": "folder/Note1.md", "matchedContent": "...一致箇所前後のコンテキスト..."}
  ]
}
```

`searchContent` が `true` の場合、`matchedContent` には一致箇所の前後約 50 文字のコンテキストが含まれます。

### folder-list

Vault 内のフォルダを一覧表示します。

```yaml
- id: listFolders
  type: folder-list
  folder: "Projects"
  saveTo: folderList
```

| プロパティ | 説明 |
|------------|------|
| `folder` | 親フォルダパス（空で Vault 全体） |
| `saveTo` | 結果を格納する変数（必須） |

**出力形式:**
```json
{
  "folders": ["Projects/Active", "Projects/Archive", "Projects/Ideas"],
  "count": 3
}
```

フォルダはアルファベット順にソートされます。

### open

Obsidian でファイルを開きます。

```yaml
- id: openNote
  type: open
  path: "{{outputPath}}"
```

| プロパティ | 説明 |
|------------|------|
| `path` | 開くファイルパス（必須、`{{variables}}` 対応） |

パスに `.md` 拡張子がない場合、自動的に追加されます。

### http

HTTP リクエストを実行します。

```yaml
- id: fetch
  type: http
  url: "https://api.example.com/data"
  method: POST
  contentType: json
  headers: '{"Authorization": "Bearer {{token}}"}'
  body: '{"query": "{{searchTerm}}"}'
  saveTo: response
  saveStatus: statusCode
  throwOnError: "true"
```

| プロパティ | 説明 |
|------------|------|
| `url` | リクエスト URL（必須） |
| `method` | `GET`（デフォルト）、`POST`、`PUT`、`PATCH`、`DELETE` |
| `contentType` | `json`（デフォルト）、`form-data`、`text`、`binary` |
| `responseType` | `auto`（デフォルト）、`text`、`binary`。レスポンス処理の Content-Type 自動検出をオーバーライド |
| `headers` | JSON オブジェクトまたは `Key: Value` 形式（1 行に 1 つ） |
| `body` | リクエストボディ（POST/PUT/PATCH 用） |
| `saveTo` | レスポンスボディを格納する変数 |
| `saveStatus` | HTTP ステータスコードを格納する変数 |
| `throwOnError` | `true` で 4xx/5xx レスポンス時にエラーをスロー |

**form-data の例**（file-explorer でバイナリファイルをアップロード）:

```yaml
- id: select-pdf
  type: file-explorer
  path: "{{_eventFilePath}}"
  extensions: "pdf,png,jpg"
  saveTo: fileData
- id: upload
  type: http
  url: "https://example.com/upload"
  method: POST
  contentType: form-data
  body: '{"file": "{{fileData}}"}'
  saveTo: response
```

`form-data` の場合:
- FileExplorerData（`file-explorer` ノードから）は自動検出されバイナリとして送信
- テキストファイルフィールドには `fieldName:filename` 構文を使用（例: `"file:report.html": "{{htmlContent}}"`)

### json

JSON 文字列をオブジェクトにパースしてプロパティアクセスを可能にします。

```yaml
- id: parseResponse
  type: json
  source: response
  saveTo: data
```

| プロパティ | 説明 |
|------------|------|
| `source` | JSON 文字列を含む変数名（必須） |
| `saveTo` | パース結果を格納する変数名（必須） |

パース後、ドット記法でプロパティにアクセス: `{{data.items[0].name}}`

**Markdown コードブロック内の JSON:**

`json` ノードは Markdown コードブロックから JSON を自動抽出します:

```yaml
# レスポンスが以下を含む場合:
# ```json
# {"status": "ok"}
# ```
# json ノードは JSON コンテンツのみを抽出してパース
- id: parse
  type: json
  source: llmResponse
  saveTo: parsed
```

LLM レスポンスが JSON をコードフェンスで囲む場合に便利です。

### dialog

選択肢、ボタン、テキスト入力を含むダイアログを表示します。

```yaml
- id: ask
  type: dialog
  title: オプション選択
  message: 処理するアイテムを選択
  markdown: true
  options: "オプション A, オプション B, オプション C"
  multiSelect: true
  inputTitle: "追加メモ"
  multiline: true
  defaults: '{"input": "デフォルトテキスト", "selected": ["オプション A"]}'
  button1: 確認
  button2: キャンセル
  saveTo: dialogResult
```

| プロパティ | 説明 |
|------------|------|
| `title` | ダイアログタイトル |
| `message` | メッセージ内容（`{{variables}}` 対応） |
| `markdown` | `true` でメッセージを Markdown としてレンダリング |
| `options` | 選択肢のカンマ区切りリスト（任意） |
| `multiSelect` | `true` でチェックボックス、`false` でラジオボタン |
| `inputTitle` | テキスト入力フィールドのラベル（設定時に入力欄を表示） |
| `multiline` | `true` で複数行テキストエリア |
| `defaults` | `input` と `selected` の初期値を含む JSON |
| `button1` | プライマリボタンのラベル（デフォルト: "OK"） |
| `button2` | セカンダリボタンのラベル（任意） |
| `saveTo` | 結果を格納する変数（下記参照） |

**結果の形式**（`saveTo` 変数）:
- `button`: string - クリックされたボタンのテキスト（例: "確認"、"キャンセル"）
- `selected`: string[] - **常に配列**、単一選択でも（例: `["オプション A"]`）
- `input`: string - テキスト入力値（`inputTitle` が設定されている場合）

> **重要:** `if` 条件で選択値を確認する場合:
> - 単一オプション: `{{dialogResult.selected[0]}} == オプション A`
> - 配列に値が含まれるか確認（multiSelect）: `{{dialogResult.selected}} contains オプション A`
> - 誤り: `{{dialogResult.selected}} == オプション A`（配列と文字列の比較、常に false）

**シンプルなテキスト入力:**
```yaml
- id: input
  type: dialog
  title: 値を入力
  inputTitle: 入力内容
  multiline: true
  saveTo: userInput
```

### workflow

別のワークフローをサブワークフローとして実行します。

```yaml
- id: runSub
  type: workflow
  path: "workflows/summarize.md"
  name: "Summarizer"
  input: '{"text": "{{content}}"}'
  output: '{"result": "summary"}'
  prefix: "sub_"
```

| プロパティ | 説明 |
|------------|------|
| `path` | ワークフローファイルのパス（必須） |
| `name` | ワークフロー名（複数ワークフローを含むファイル用） |
| `input` | サブワークフロー変数に値をマッピングする JSON |
| `output` | 親変数にサブワークフローの結果をマッピングする JSON |
| `prefix` | すべての出力変数のプレフィックス（`output` 未指定時） |

### rag-sync

ノートを RAG ストアに同期します。`path` を指定すると単一ファイルを高速同期します。`path` を省略すると、設定された対象フォルダ内の全ノートを一括同期します。

**単一ファイル同期:**
```yaml
- id: sync
  type: rag-sync
  path: "{{_eventFilePath}}"
  saveTo: syncResult
```

**全同期:**
```yaml
- id: syncAll
  type: rag-sync
  saveTo: syncResult
```

| プロパティ | 説明 |
|------------|------|
| `path` | 同期するノートパス（任意、`{{variables}}` 対応）。省略時は全同期。 |
| `oldPath` | インデックスから削除する旧ファイルパス（任意、リネーム時に使用） |
| `saveTo` | 結果を格納する変数（任意） |

**出力形式（単一ファイル）:**
```json
{
  "path": "folder/note.md",
  "syncedAt": "2025-01-01T12:00:00.000Z"
}
```

**出力形式（全同期）:**
```json
{
  "syncedAt": 1704067200000,
  "totalChunks": 150,
  "indexedFiles": 42
}
```

### file-explorer

Vault からファイルを選択または新しいファイルパスを入力します。画像や PDF を含むあらゆるファイルタイプに対応。

```yaml
- id: selectImage
  type: file-explorer
  mode: select
  title: "画像を選択"
  extensions: "png,jpg,jpeg,gif,webp"
  default: "images/"
  saveTo: imageData
  savePathTo: imagePath
```

| プロパティ | 説明 |
|------------|------|
| `path` | ファイルパスを直接指定 — 設定時はダイアログをスキップ（`{{variables}}` 対応） |
| `mode` | `select`（既存ファイルを選択、デフォルト）または `create`（新しいパスを入力） |
| `title` | ダイアログタイトル |
| `extensions` | 許可する拡張子のカンマ区切り（例: `pdf,png,jpg`） |
| `default` | デフォルトパス（`{{variables}}` 対応） |
| `saveTo` | FileExplorerData JSON を格納する変数 |
| `savePathTo` | ファイルパスのみを格納する変数 |

**FileExplorerData 形式:**
```json
{
  "path": "folder/image.png",
  "basename": "image.png",
  "name": "image",
  "extension": "png",
  "mimeType": "image/png",
  "contentType": "binary",
  "data": "base64エンコードされた内容"
}
```

**例: 画像分析（ダイアログあり）**
```yaml
- id: selectImage
  type: file-explorer
  title: "分析する画像を選択"
  extensions: "png,jpg,jpeg,gif,webp"
  saveTo: imageData
- id: analyze
  type: command
  prompt: "この画像を詳しく説明してください"
  attachments: imageData
  saveTo: analysis
- id: save
  type: note
  path: "analysis/{{imageData.name}}.md"
  content: "# 画像分析\n\n{{analysis}}"
```

**例: イベントトリガー（ダイアログなし）**
```yaml
- id: loadImage
  type: file-explorer
  path: "{{_eventFilePath}}"
  saveTo: imageData
- id: analyze
  type: command
  prompt: "この画像を説明してください"
  attachments: imageData
  saveTo: result
```

### file-save

FileExplorerData を Vault 内のファイルとして保存します。コピーしたファイルの保存に便利です。

```yaml
- id: saveFile
  type: file-save
  source: selectedFile
  path: "output/saved"
  savePathTo: savedPath
```

| プロパティ | 説明 |
|------------|------|
| `source` | FileExplorerData を含む変数名（必須） |
| `path` | ファイルの保存先パス（拡張子がない場合は自動追加） |
| `savePathTo` | 最終ファイルパスを格納する変数（任意） |

### prompt-file

ファイルピッカーを表示、またはホットキー/イベントモードでアクティブファイルを使用します。

```yaml
- id: selectFile
  type: prompt-file
  title: ノートを選択
  default: "notes/"
  forcePrompt: "true"
  saveTo: content
  saveFileTo: fileInfo
```

| プロパティ | 説明 |
|------------|------|
| `title` | ダイアログタイトル |
| `default` | デフォルトパス |
| `forcePrompt` | `true` でホットキー/イベントモードでも常にダイアログを表示 |
| `saveTo` | ファイル内容を格納する変数 |
| `saveFileTo` | ファイル情報 JSON を格納する変数 |

**ファイル情報の形式:** `{"path": "folder/note.md", "basename": "note.md", "name": "note", "extension": "md"}`

**トリガーモード別の動作:**
| モード | 動作 |
|--------|------|
| パネル | ファイルピッカーダイアログを表示 |
| ホットキー | アクティブファイルを自動使用 |
| イベント | イベントファイルを自動使用 |

### prompt-selection

選択テキストを取得、または選択ダイアログを表示します。

```yaml
- id: getSelection
  type: prompt-selection
  saveTo: text
  saveSelectionTo: selectionInfo
```

| プロパティ | 説明 |
|------------|------|
| `saveTo` | 選択テキストを格納する変数 |
| `saveSelectionTo` | 選択メタデータ JSON を格納する変数 |

**選択情報の形式:** `{"filePath": "...", "startLine": 1, "endLine": 1, "start": 0, "end": 10}`

**トリガーモード別の動作:**
| モード | 動作 |
|--------|------|
| パネル | 選択ダイアログを表示 |
| ホットキー（選択あり） | 現在の選択を使用 |
| ホットキー（選択なし） | ファイル全体の内容を使用 |
| イベント | ファイル全体の内容を使用 |

### if / while

条件分岐とループ。

```yaml
- id: branch
  type: if
  condition: "{{count}} > 10"
  trueNext: handleMany
  falseNext: handleFew

- id: loop
  type: while
  condition: "{{counter}} < {{total}}"
  trueNext: processItem
  falseNext: done
```

| プロパティ | 説明 |
|------------|------|
| `condition` | 演算子を含む式: `==`、`!=`、`<`、`>`、`<=`、`>=`、`contains` |
| `trueNext` | 条件が true の場合のノード ID |
| `falseNext` | 条件が false の場合のノード ID |

**`contains` 演算子**は文字列と配列の両方に対応:
- 文字列: `{{text}} contains error` — 文字列に "error" が含まれるか確認
- 配列: `{{dialogResult.selected}} contains オプション A` — 配列に "オプション A" が含まれるか確認

> **後方参照ルール**: `next` プロパティは、ターゲットが `while` ノードの場合のみ前方のノードを参照できます。これによりスパゲッティコードを防ぎ、適切なループ構造を保証します。例: `next: loop` は `loop` が `while` ノードの場合のみ有効。

### variable / set

変数の宣言と更新。

```yaml
- id: init
  type: variable
  name: counter
  value: 0

- id: increment
  type: set
  name: counter
  value: "{{counter}} + 1"
```

**特殊変数 `_clipboard`:**

`_clipboard` という名前の変数を設定すると、その値がシステムクリップボードにコピーされます:

```yaml
- id: copyToClipboard
  type: set
  name: _clipboard
  value: "{{result}}"
```

他のアプリケーションやクリップボードから読み取る Obsidian プラグインとの連携に便利です。

### obsidian-command

Obsidian コマンドを ID で実行します。他のプラグインのコマンドを含む、あらゆる Obsidian コマンドをワークフローからトリガーできます。

```yaml
- id: toggle-fold
  type: obsidian-command
  command: "editor:toggle-fold"
  saveTo: result
```

| プロパティ | 説明 |
|------------|------|
| `command` | 実行するコマンド ID（必須、`{{variables}}` 対応） |
| `path` | コマンド実行前に開くファイル（任意、タブは開いたまま） |
| `saveTo` | 実行結果を格納する変数（任意） |

**出力形式**（`saveTo` 設定時）:
```json
{
  "commandId": "editor:toggle-fold",
  "path": "notes/example.md",
  "executed": true,
  "timestamp": 1704067200000
}
```

**コマンド ID の調べ方:**
1. Obsidian 設定 → ホットキーを開く
2. 使用したいコマンドを検索
3. コマンド ID が表示される（例: `editor:toggle-fold`、`app:reload`）

**よく使うコマンド ID:**
| コマンド ID | 説明 |
|-------------|------|
| `editor:toggle-fold` | カーソル位置の折りたたみ切り替え |
| `editor:fold-all` | すべての見出しを折りたたみ |
| `editor:unfold-all` | すべての見出しを展開 |
| `app:reload` | Obsidian をリロード |
| `workspace:close` | 現在のペインを閉じる |
| `file-explorer:reveal-active-file` | エクスプローラーでファイルを表示 |

**例: ディレクトリ内のすべてのファイルを暗号化**

```yaml
name: encrypt-folder
nodes:
  - id: init-index
    type: variable
    name: index
    value: "0"
  - id: list-files
    type: note-list
    folder: "private"
    recursive: "true"
    saveTo: fileList
  - id: loop
    type: while
    condition: "{{index}} < {{fileList.count}}"
    trueNext: encrypt
    falseNext: done
  - id: encrypt
    type: obsidian-command
    command: "local-llm-hub:encrypt-file"
    path: "{{fileList.notes[index].path}}"
  - id: wait
    type: sleep
    duration: "1000"
  - id: close-tab
    type: obsidian-command
    command: "workspace:close"
  - id: increment
    type: set
    name: index
    value: "{{index}} + 1"
    next: loop
  - id: done
    type: dialog
    title: "完了"
    message: "{{index}} 個のファイルを暗号化しました"
```

> **注意:** 暗号化コマンドは非同期で実行されるため、`sleep` ノードを使用してタブを閉じる前に操作の完了を待ちます。

### script

サンドボックス化された iframe で JavaScript コードを実行します。サンドボックスは DOM、ネットワーク、ストレージへのアクセスがなく、純粋な計算のみ可能です。

```yaml
- id: transform
  type: script
  code: |
    const lines = input.split('\n');
    return lines.filter(l => l.trim()).map(l => '- ' + l).join('\n');
  timeout: 5000
  saveTo: result
```

| プロパティ | 説明 |
|------------|------|
| `code` | 実行する JavaScript コード（必須、`{{variables}}` 対応） |
| `saveTo` | 戻り値を格納する変数名 |
| `timeout` | 実行タイムアウト（ミリ秒、デフォルト: 10000） |

`return` で値を返します。`input` 変数が利用可能です。結果は自動的に文字列化されます（オブジェクトは JSON になります）。

**セキュリティ:** コードは `sandbox="allow-scripts"`（`allow-same-origin` なし）の iframe で実行されます。CSP によりすべてのネットワークアクセス（`fetch`、`XMLHttpRequest`、`WebSocket`）がブロックされます。親 DOM、Cookie、localStorage、IndexedDB へのアクセスもありません。

**例: CSV を解析してカラムを抽出**
```yaml
- id: readCsv
  type: note-read
  path: "data/input.csv"
  saveTo: csvData
- id: extractNames
  type: script
  code: |
    const rows = input.split('\n').map(r => r.split(','));
    const nameCol = rows[0].indexOf('name');
    return rows.slice(1).map(r => r[nameCol]).join('\n');
  saveTo: names
```

この例では、`{{csvData}}` がコードテンプレートに自動的に代入されてから実行されます。`code` プロパティ内で `{{variable}}` 構文を使用して任意のワークフロー変数を参照できます。

### sleep

ワークフロー実行を指定時間だけ一時停止します。非同期操作の完了待ちに便利です。

```yaml
- id: wait
  type: sleep
  duration: "1000"
```

| プロパティ | 説明 |
|------------|------|
| `duration` | スリープ時間（ミリ秒、必須、`{{variables}}` 対応） |

---

## ワークフローの終了

`next: end` でワークフローを明示的に終了できます:

```yaml
- id: save
  type: note
  path: "output.md"
  content: "{{result}}"
  next: end    # ワークフローはここで終了

- id: branch
  type: if
  condition: "{{cancel}}"
  trueNext: end      # true 分岐でワークフローを終了
  falseNext: continue
```

## 変数展開

`{{variable}}` 構文で変数を参照できます:

```yaml
# 基本
path: "{{folder}}/{{filename}}.md"

# オブジェクト/配列アクセス
url: "https://api.example.com?lat={{geo.latitude}}"
content: "{{items[0].name}}"

# ネストした変数（ループ用）
path: "{{parsed.notes[{{counter}}].path}}"
```

### JSON エスケープ修飾子

`{{variable:json}}` で JSON 文字列に埋め込むための値をエスケープできます。改行、引用符、その他の特殊文字を適切にエスケープします。

```yaml
# :json なし — 内容に改行/引用符があると壊れる
body: '{"text": "{{content}}"}'  # 特殊文字があるとエラー

# :json あり — あらゆる内容で安全
body: '{"text": "{{content:json}}"}'  # OK — 適切にエスケープ
```

ファイル内容やユーザー入力を JSON ボディで `http` ノードに渡す場合に必須です。

## スマート入力ノード

`prompt-selection` と `prompt-file` ノードは実行コンテキストを自動検出します:

| ノード | パネルモード | ホットキーモード | イベントモード |
|--------|-------------|-----------------|---------------|
| `prompt-file` | ファイルピッカーを表示 | アクティブファイルを使用 | イベントファイルを使用 |
| `prompt-selection` | 選択ダイアログを表示 | 選択またはファイル全体を使用 | ファイル全体の内容を使用 |

---

## イベントトリガー

ワークフローは Obsidian のイベントで自動的にトリガーできます。

### 利用可能なイベント

| イベント | 説明 |
|----------|------|
| `create` | ファイル作成 |
| `modify` | ファイル変更/保存（5 秒デバウンス） |
| `delete` | ファイル削除 |
| `rename` | ファイル名変更 |
| `file-open` | ファイルオープン |

### イベント変数

イベントでトリガーされた場合、以下の変数が自動設定されます:

| 変数 | 説明 |
|------|------|
| `_eventType` | イベントタイプ: `create`、`modify`、`delete`、`rename`、`file-open` |
| `_eventFilePath` | 対象ファイルのパス |
| `_eventFile` | JSON: `{"path": "...", "basename": "...", "name": "...", "extension": "..."}` |
| `_eventFileContent` | ファイル内容（create/modify/file-open イベント用） |
| `_eventOldPath` | 変更前のパス（rename イベントのみ） |

### ファイルパターン構文

glob パターンでイベントをファイルパスでフィルタ:

| パターン | 一致対象 |
|----------|----------|
| `**/*.md` | 任意のフォルダ内のすべての .md ファイル |
| `journal/*.md` | journal フォルダ直下の .md ファイル |
| `*.md` | ルートフォルダの .md ファイルのみ |
| `**/{daily,weekly}/*.md` | daily または weekly フォルダ内のファイル |
| `projects/[a-z]*.md` | 小文字で始まるファイル |
| `docs/**` | docs フォルダ配下のすべてのファイル |

### イベントトリガーワークフローの例

````markdown
```workflow
name: Auto-Tag New Notes
nodes:
  - id: getContent
    type: prompt-selection
    saveTo: content
  - id: analyze
    type: command
    prompt: "このノートに 3 つのタグを提案してください:\n\n{{content}}"
    saveTo: tags
  - id: prepend
    type: note
    path: "{{_eventFilePath}}"
    content: "---\ntags: {{tags}}\n---\n\n{{content}}"
    mode: overwrite
    confirm: false
```
````

**設定:** ワークフローパネルのイベントトリガーアイコンをクリック → 「ファイル作成」を有効化 → パターンに `**/*.md` を設定

---

## 実用例

### 1. ノート要約

````markdown
```workflow
name: Note Summary
nodes:
  - id: select
    type: prompt-file
    title: ノートを選択
    saveTo: content
    saveFileTo: fileInfo
  - id: parseFile
    type: json
    source: fileInfo
    saveTo: file
  - id: summarize
    type: command
    prompt: "このノートを要約してください:\n\n{{content}}"
    saveTo: summary
  - id: save
    type: note
    path: "summaries/{{file.name}}"
    content: "# 要約\n\n{{summary}}\n\n---\n*ソース: {{file.path}}*"
    mode: create
```
````

### 2. 条件付き処理

````markdown
```workflow
name: Smart Summarizer
nodes:
  - id: input
    type: dialog
    title: 処理するテキストを入力
    inputTitle: テキスト
    multiline: true
    saveTo: userInput
  - id: branch
    type: if
    condition: "{{userInput.input.length}} > 500"
    trueNext: summarize
    falseNext: enhance
  - id: summarize
    type: command
    prompt: "この長いテキストを要約してください:\n\n{{userInput.input}}"
    saveTo: result
    next: save
  - id: enhance
    type: command
    prompt: "この短いテキストを拡張・強化してください:\n\n{{userInput.input}}"
    saveTo: result
    next: save
  - id: save
    type: note
    path: "processed/output.md"
    content: "{{result}}"
    mode: overwrite
```
````

### 3. ノートの一括処理

````markdown
```workflow
name: Tag Analyzer
nodes:
  - id: init
    type: variable
    name: counter
    value: 0
  - id: initReport
    type: variable
    name: report
    value: "# タグ提案\n\n"
  - id: list
    type: note-list
    folder: Clippings
    limit: 5
    saveTo: notes
  - id: json
    type: json
    source: notes
    saveTo: parsed
  - id: loop
    type: while
    condition: "{{counter}} < {{parsed.count}}"
    trueNext: read
    falseNext: finish
  - id: read
    type: note-read
    path: "{{parsed.notes[{{counter}}].path}}"
    saveTo: content
  - id: analyze
    type: command
    prompt: "3 つのタグを提案してください:\n\n{{content}}"
    saveTo: tags
  - id: append
    type: set
    name: report
    value: "{{report}}## {{parsed.notes[{{counter}}].name}}\n{{tags}}\n\n"
  - id: increment
    type: set
    name: counter
    value: "{{counter}} + 1"
    next: loop
  - id: finish
    type: note
    path: "reports/tag-suggestions.md"
    content: "{{report}}"
    mode: overwrite
```
````

### 4. API 連携

````markdown
```workflow
name: Weather Report
nodes:
  - id: city
    type: dialog
    title: 都市名
    inputTitle: 都市
    saveTo: cityInput
  - id: geocode
    type: http
    url: "https://geocoding-api.open-meteo.com/v1/search?name={{cityInput.input}}&count=1"
    method: GET
    saveTo: geoResponse
  - id: parseGeo
    type: json
    source: geoResponse
    saveTo: geo
  - id: weather
    type: http
    url: "https://api.open-meteo.com/v1/forecast?latitude={{geo.results[0].latitude}}&longitude={{geo.results[0].longitude}}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto"
    method: GET
    saveTo: weatherData
  - id: parse
    type: json
    source: weatherData
    saveTo: data
  - id: report
    type: command
    prompt: "天気レポートを作成してください:\n{{data}}"
    saveTo: summary
  - id: save
    type: note
    path: "weather/{{cityInput.input}}.md"
    content: "# 天気: {{cityInput.input}}\n\n{{summary}}"
    mode: overwrite
```
````

### 5. 選択テキストの翻訳（ホットキー付き）

````markdown
```workflow
name: Translate Selection
nodes:
  - id: getSelection
    type: prompt-selection
    saveTo: text
  - id: translate
    type: command
    prompt: "以下のテキストを英語に翻訳してください:\n\n{{text}}"
    saveTo: translated
  - id: output
    type: note
    path: "translations/translated.md"
    content: "## 原文\n{{text}}\n\n## 翻訳\n{{translated}}\n\n---\n"
    mode: append
  - id: show
    type: open
    path: "translations/translated.md"
```
````

**ホットキーの設定:**
1. ワークフローに `name:` フィールドを追加
2. ワークフローファイルを開き、ドロップダウンからワークフローを選択
3. ワークフローパネルのフッターにあるキーボードアイコンをクリック
4. 設定 → ホットキーで "Workflow: Translate Selection" を検索
5. ホットキーを割り当て（例: `Ctrl+Shift+T`）

### 6. サブワークフローの合成

**ファイル: `workflows/translate.md`**
````markdown
```workflow
name: Translator
nodes:
  - id: translate
    type: command
    prompt: "{{targetLang}} に翻訳してください:\n\n{{text}}"
    saveTo: translated
```
````

**ファイル: `workflows/main.md`**
````markdown
```workflow
name: Multi-Language Export
nodes:
  - id: input
    type: dialog
    title: 翻訳するテキストを入力
    inputTitle: テキスト
    multiline: true
    saveTo: userInput
  - id: toJapanese
    type: workflow
    path: "workflows/translate.md"
    name: "Translator"
    input: '{"text": "{{userInput.input}}", "targetLang": "Japanese"}'
    output: '{"japaneseText": "translated"}'
  - id: toSpanish
    type: workflow
    path: "workflows/translate.md"
    name: "Translator"
    input: '{"text": "{{userInput.input}}", "targetLang": "Spanish"}'
    output: '{"spanishText": "translated"}'
  - id: save
    type: note
    path: "translations/output.md"
    content: |
      # 原文
      {{userInput.input}}

      ## 日本語
      {{japaneseText}}

      ## スペイン語
      {{spanishText}}
    mode: overwrite
```
````

### 7. インタラクティブなタスク選択

````markdown
```workflow
name: Task Processor
nodes:
  - id: selectTasks
    type: dialog
    title: タスク選択
    message: 現在のノートに対して実行するタスクを選択
    options: "要約, キーポイント抽出, 英語に翻訳, 文法修正"
    multiSelect: true
    button1: 処理
    button2: キャンセル
    saveTo: selection
  - id: checkCancel
    type: if
    condition: "{{selection.button}} == 'キャンセル'"
    trueNext: cancelled
    falseNext: getFile
  - id: getFile
    type: prompt-file
    saveTo: content
  - id: process
    type: command
    prompt: |
      このテキストに対して以下のタスクを実行してください:
      タスク: {{selection.selected}}

      テキスト:
      {{content}}
    saveTo: result
  - id: save
    type: note
    path: "processed/result.md"
    content: "{{result}}"
    mode: create
    next: end
  - id: cancelled
    type: dialog
    title: キャンセル
    message: ユーザーによって操作がキャンセルされました。
    button1: OK
    next: end
```
````
