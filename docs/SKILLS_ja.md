# エージェントスキル

エージェントスキルを使うと、再利用可能な指示や参考資料を AI のシステムプロンプトに注入できます。各スキルは `SKILL.md` ファイルを含むフォルダで、任意で参考ファイルを追加できます。

## フォルダ構造

スキルは `{workspaceFolder}/{skillsFolder}/`（デフォルト: `LocalLlmHub/skills/`）配下に格納します。`SKILL.md` を含むサブフォルダがスキルとして検出されます。

```
LocalLlmHub/
  skills/
    code-review/
      SKILL.md
      references/
        coding-standards.md
        review-checklist.md
    translator/
      SKILL.md
    meeting-notes/
      SKILL.md
      references/
        template.md
```

## SKILL.md の形式

各 `SKILL.md` ファイルは YAML フロントマターにメタデータを持ち、その後に Markdown で指示本文を記述します。

```markdown
---
name: Code Review
description: Reviews code for quality, security, and best practices
---

あなたは熟練のコードレビュアーです。コードレビュー時:

1. セキュリティ脆弱性（インジェクション、XSS 等）をチェック
2. パフォーマンスの問題を特定
3. 可読性の改善を提案
4. エラーハンドリングの適切さを確認

具体的な行番号と実用的な提案を提示してください。
```

### フロントマターのフィールド

| フィールド | 必須 | 説明 |
|------------|------|------|
| `name` | いいえ | 表示名（デフォルト: フォルダ名） |
| `description` | いいえ | スキル選択ドロップダウンに表示される短い説明 |

### 指示本文

フロントマターの後の Markdown 本文は、スキルが有効な時にシステムプロンプトに注入されます。AI の動作を導く明確で具体的な指示を書いてください。

## 参考ファイル

`references/` サブフォルダに追加ファイルを配置してコンテキストを提供できます。このフォルダ内のすべてのファイルが読み込まれ、スキルのシステムプロンプトセクションに追加されます。

```
code-review/
  SKILL.md
  references/
    coding-standards.md    # チームのコーディング規約
    review-checklist.md    # チェックリスト
```

参考ファイルは以下の形式で含まれます:

```
### References

[coding-standards.md]
(ファイルの内容)

[review-checklist.md]
(ファイルの内容)
```

参考ファイルには、指示ではないが AI が知っておくべき内容を配置します — コーディング規約、テンプレート、スタイルガイド、用語集など。

## チャットでのスキルの使用

1. スキルは設定されたスキルフォルダから自動的に検出されます
2. スキルが利用可能な場合、チャットメッセージの上にスキル選択バー（スパークルアイコン付き）が表示されます
3. **+** をクリックしてドロップダウンを開き、スキルのチェック/解除
4. 有効なスキルはチップとして表示 — **×** をクリックして無効化
5. 選択したスキルは同じチャットセッション内のメッセージ間で有効のまま

スキルが有効な場合、システムプロンプトには以下が含まれます:

```
The following agent skills are active:

## Skill: Code Review

(SKILL.md の指示内容)

### References

(参考ファイルの内容)
```

アシスタントメッセージのメタデータに使用されたスキルが表示されます（"Skills used: ..." として表示）。

## スキルワークフロー

スキルはワークフローを公開でき、AI がチャット中に `run_skill_workflow` ツールで実行できます。ワークフローは 2 つの方法で検出されます:

### 1. フロントマターでの宣言

SKILL.md のフロントマターの `workflows` 配列でワークフローを宣言:

```markdown
---
name: Data Pipeline
description: Processes and transforms data
workflows:
  - path: workflows/extract.md
    name: Extractor
    description: Extract structured data from text
  - path: workflows/transform.md
    description: Transform data format
---
```

| フィールド | 必須 | 説明 |
|------------|------|------|
| `path` | はい | スキルフォルダからワークフローファイルへの相対パス |
| `name` | いいえ | ワークフロー名（複数ワークフローを含むファイル用） |
| `description` | いいえ | AI に表示される説明（デフォルト: パス） |

### 2. 自動検出

`workflows/` サブフォルダにワークフローファイルを配置すると自動的に検出されます:

```
my-skill/
  SKILL.md
  workflows/
    extract.md      # 自動検出
    transform.md    # 自動検出
  references/
    schema.md
```

フロントマターで宣言されたワークフローが優先されます — 同じパスが両方にある場合、フロントマター版が使用されます。

ワークフロー付きスキルが有効になると、`run_skill_workflow` ツールが利用可能なツールに自動追加され、AI がチャット中にこれらのワークフローを実行できるようになります。

## 設定

プラグイン設定の **ワークスペース** セクション:

| 設定 | デフォルト | 説明 |
|------|-----------|------|
| スキルフォルダ | `skills` | ワークスペースフォルダからの相対サブフォルダ名 |

フルパスは `{workspaceFolder}/{skillsFolder}`（例: `LocalLlmHub/skills`）です。

## 例

### 翻訳者

```markdown
---
name: Translator
description: Translates text between languages
---

あなたはプロの翻訳者です。翻訳時:

- 原文の意味とトーンを保持
- 目標言語で自然な表現を使用
- 技術用語の一貫性を維持
- 原文が曖昧な場合は確認を求める
```

### 議事録

```markdown
---
name: Meeting Notes
description: Structures meeting notes with action items
---

議事録を処理する際:

1. 参加者とその役割を特定
2. 重要な決定事項を抽出
3. 担当者と期限付きのアクションアイテムをリスト化
4. トピックごとに議論のポイントを要約
5. 未解決の問題をフラグ付け

参考ファイルのテンプレートに従って出力をフォーマットしてください。
```

`references/template.md`:

```markdown
# 会議: {title}
**日付:** {date}
**参加者:** {list}

## 決定事項
- ...

## アクションアイテム
- [ ] {task} — @{owner}（期限: {date}）

## 議論の要約
### {topic}
...

## 未解決の問題
- ...
```

### ライティングアシスタント

```markdown
---
name: Writing Assistant
description: Helps improve writing style and clarity
---

あなたはライティングコーチです。テキストをレビューする際:

- 文法・スペルの誤りを修正
- 明瞭さのために文構造を改善
- より適切な言葉選びを提案
- 著者の声とインテントを維持
- 繰り返しや冗長さを指摘

修正後のテキストを最初に提示し、次に変更内容とその理由をリスト化してください。
```
