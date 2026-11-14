<div align="center">

# 图册批量重命名 · Album Renamer

**给扫描图册、照片批量改名的本地小工具**

<a href="#-简体中文">简体中文</a> ·
<a href="#-繁體中文">繁體中文</a> ·
<a href="#-english">English</a> ·
<a href="#-日本語">日本語</a>

</div>

---

## 🇨🇳 简体中文

界面在浏览器里，文件读写由本地 Node 服务完成。**不联网、不上传**，图片始终留在本机。

### 环境要求

| 依赖 | 版本 |
|---|---|
| Node.js | 18 或更高 |
| 浏览器 | Chrome / Edge / Firefox 任一现代浏览器 |

### 快速开始

1. 双击 `启动.bat`，自动打开 <http://127.0.0.1:8787/>
2. 也可以把整个图片文件夹**拖到 `启动.bat` 上**，打开后直接载入
3. 关闭黑色命令行窗口即退出；端口被占用时自动顺延到 8788、8789…

### 基本流程

1. 点左上角文件夹图标，选择存放扫描图片的目录
2. 左侧编辑命名模板，右侧实时显示「旧名 → 新名」
3. 需要时拖拽卡片调整顺序，给封面 / 封底单独命名
4. 点右上角「执行重命名」，确认后落盘
5. 改错了点「撤销上次」回滚

### 命名模板

**分段编辑**：每个方块是一段，点击编辑、拖拽换位置

- `+ 文本` 固定文字（例如 `aaa`）
- `+ 分隔符` 插入 `_`、`-`、`.`、空格
- `+ 序号` 自动编号，可加前后缀和偏移
- `+ 原名` 原文件名（不含扩展名）
- `+ 原数字` 原文件名里最后一段数字（`IMG_0007` → `0007`）
- `+ 日期` 文件修改时间
- `+ 文件夹` 当前文件夹名

**直接输入语法**

```
aaa_bbb_{num:4}_ccc
图册A_{num:3}_第{num:2}页
{orig}_{date:YYYYMMDD}
```

| 占位符 | 含义 |
|---|---|
| `{num}` / `{num:4}` / `{0001}` | 序号，冒号后是补零位数 |
| `{orig}` | 原文件名 |
| `{digits}` | 原文件名里的数字 |
| `{date}` / `{date:YYYY-MM-DD}` | 修改日期 |
| `{folder}` | 文件夹名 |

### 其他功能

- 排序：文件名（自然排序，`2` 在 `10` 前）、修改时间、大小、手动
- 多模板：封面 / 正文各自独立计数，互不影响
- 单张锁定命名：选中某张点「自定义名」，这张不占页码
- 文件夹选择器会记住上次位置，子文件夹多时可用过滤框快速筛选
- 改错了可撤销上一次重命名

### 目录结构

```
index.html / app.js / app.css   浏览器界面
server.mjs                       本地 Node 服务（读写文件）
启动.bat                         启动脚本
```

## 🇹🇼 繁體中文

介面在瀏覽器裡，檔案讀寫由本機 Node 服務完成。**不連網、不上傳**，圖片始終留在本機。

### 環境需求

| 依賴 | 版本 |
|---|---|
| Node.js | 18 或更高 |
| 瀏覽器 | Chrome / Edge / Firefox 任一現代瀏覽器 |

### 快速開始

1. 雙擊 `啟動.bat`，自動開啟 <http://127.0.0.1:8787/>
2. 也可以把整個圖片資料夾**拖到 `啟動.bat` 上**，開啟後直接載入
3. 關閉黑色命令列視窗即結束；連接埠被佔用時自動順延到 8788、8789…

### 基本流程

1. 點左上角資料夾圖示，選擇存放掃描圖片的目錄
2. 左側編輯命名樣板，右側即時顯示「舊名 → 新名」
3. 需要時拖曳卡片調整順序，為封面 / 封底單獨命名
4. 點右上角「執行重新命名」，確認後寫入
5. 改錯了點「復原上一次」回復

### 命名樣板

**分段編輯**：每個方塊是一段，點擊編輯、拖曳換位置

- `+ 文字` 固定文字（例如 `aaa`）
- `+ 分隔符` 插入 `_`、`-`、`.`、空格
- `+ 序號` 自動編號，可加前後綴與偏移
- `+ 原名` 原檔名（不含副檔名）
- `+ 原數字` 原檔名裡最後一段數字（`IMG_0007` → `0007`）
- `+ 日期` 檔案修改時間
- `+ 資料夾` 目前資料夾名稱

**直接輸入語法**

```
aaa_bbb_{num:4}_ccc
圖冊A_{num:3}_第{num:2}頁
{orig}_{date:YYYYMMDD}
```

| 佔位符 | 含義 |
|---|---|
| `{num}` / `{num:4}` / `{0001}` | 序號，冒號後是補零位數 |
| `{orig}` | 原檔名 |
| `{digits}` | 原檔名裡的數字 |
| `{date}` / `{date:YYYY-MM-DD}` | 修改日期 |
| `{folder}` | 資料夾名稱 |

### 其他功能

- 排序：檔名（自然排序，`2` 在 `10` 前）、修改時間、大小、手動
- 多樣板：封面 / 正文各自獨立計數，互不影響
- 單張鎖定命名：選中某張點「自訂名」，這張不佔頁碼
- 資料夾選擇器會記住上次位置，子資料夾多時可用過濾框快速篩選
- 改錯了可復原上一次重新命名

## 🇬🇧 English

A local batch renamer for scanned albums and photo sets. The UI runs in your browser; all file I/O is done by a local Node process. **Nothing is uploaded** — your images never leave the machine.

### Requirements

| Dependency | Version |
|---|---|
| Node.js | 18 or newer |
| Browser | Chrome / Edge / Firefox (any modern browser) |

### Quick start

1. Double-click `启动.bat` (start). It opens <http://127.0.0.1:8787/>
2. You can also **drag a folder onto `启动.bat`** to load it immediately
3. Close the console window to quit; if the port is busy it falls back to 8788, 8789…

### Workflow

1. Click the folder icon (top-left) and pick the folder with your scans
2. Edit the naming template on the left — the right pane previews `old → new` live
3. Drag cards to reorder; give covers / back covers their own name
4. Click **执行重命名** (apply) and confirm
5. Made a mistake? **撤销上次** (undo) reverts the last run

### Naming templates

**Segment editor** — each block is one segment; click to edit, drag to reorder

- `+ 文本` literal text (e.g. `aaa`)
- `+ 分隔符` separator: `_`, `-`, `.`, space
- `+ 序号` auto counter, with prefix/suffix and offset
- `+ 原名` original file name (without extension)
- `+ 原数字` last number found in the original name (`IMG_0007` → `0007`)
- `+ 日期` file modified date
- `+ 文件夹` current folder name

**Direct syntax**

```
aaa_bbb_{num:4}_ccc
Album-{num:3}-page{num:2}
{orig}_{date:YYYYMMDD}
```

| Placeholder | Meaning |
|---|---|
| `{num}` / `{num:4}` / `{0001}` | counter; digits after the colon set zero-padding |
| `{orig}` | original file name |
| `{digits}` | digits found in the original name |
| `{date}` / `{date:YYYY-MM-DD}` | modified date |
| `{folder}` | folder name |

### Other features

- Sorting: name (natural, so `2` sorts before `10`), modified time, size, manual
- Multiple templates: covers and body pages count independently
- Per-file lock: give one file a custom name and it stops consuming page numbers
- Folder picker remembers where you were; filter box for folders with many subfolders
- Undo the last rename

## 🇯🇵 日本語

スキャンした本や写真をまとめてリネームするローカルツールです。UI はブラウザ、ファイル操作はローカルの Node プロセスが担当します。**ネットワーク送信は一切ありません**。

### 必要なもの

| 依存 | バージョン |
|---|---|
| Node.js | 18 以上 |
| ブラウザ | Chrome / Edge / Firefox など |

### クイックスタート

1. `启动.bat` をダブルクリック → <http://127.0.0.1:8787/> が開きます
2. 画像フォルダを `启动.bat` に**ドラッグ＆ドロップ**しても読み込めます
3. コンソールウィンドウを閉じると終了。ポートが使用中なら 8788、8789… に自動で移ります

### 使い方の流れ

1. 左上のフォルダアイコンから対象フォルダを選択
2. 左側で命名テンプレートを編集 → 右側に「旧名 → 新名」がリアルタイム表示
3. カードをドラッグして順序変更、表紙 / 裏表紙は個別に命名
4. 「执行重命名」を押して確定
5. 間違えたら「撤销上次」で元に戻せます

### 命名テンプレート

**セグメント編集**：ブロック単位で編集、ドラッグで並べ替え

- `+ 文本` 固定文字（例：`aaa`）
- `+ 分隔符` 区切り文字 `_` `-` `.` 空白
- `+ 序号` 連番（前後飾り・オフセット可）
- `+ 原名` 元のファイル名（拡張子なし）
- `+ 原数字` 元のファイル名の最後の数字（`IMG_0007` → `0007`）
- `+ 日期` 更新日時
- `+ 文件夹` フォルダ名

**直接入力**

```
aaa_bbb_{num:4}_ccc
図録A_{num:3}_第{num:2}頁
{orig}_{date:YYYYMMDD}
```

| プレースホルダ | 意味 |
|---|---|
| `{num}` / `{num:4}` / `{0001}` | 連番（コロン以降はゼロ埋め桁数） |
| `{orig}` | 元のファイル名 |
| `{digits}` | 元のファイル名の数字 |
| `{date}` / `{date:YYYY-MM-DD}` | 更新日 |
| `{folder}` | フォルダ名 |

### その他の機能

- 並び替え：名前（自然順、`2` が `10` より前）、更新日時、サイズ、手動
- 複数テンプレート：表紙と本文で連番を独立管理
- 個別固定：1 枚だけ任意の名前を付け、ページ番号を消費させない
- フォルダ選択は前回の位置を記憶、フィルタ入力で絞り込み可能
- 直前のリネームを取り消し
