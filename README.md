# PDF Grading Workspace（PDF 作業批改工具）

一個給教師逐份批改學生 PDF 作業的 Web App：左邊選學生、打分數，右邊讀 PDF、直接標註；按 `Enter` 就存檔並跳到下一位。
**所有資料只存在你這台電腦的瀏覽器裡**，沒有後端，沒有任何上傳，也沒有 analytics。

---

## 0. 最快的用法（不用安裝任何東西）

直接用 Chrome 或 Edge 開啟 **`PDF批改工具.html`**（也就是 `dist-portable/index.html`），就能用了。

> 這個檔案是單一 HTML，裡面已經包好 PDF.js、字型對照表（CMaps）與所有程式，離線也能用。
> 請固定從**同一個位置**開這個檔案：瀏覽器的資料是依「網址」分開保存的，檔案搬到別的資料夾，瀏覽器可能會把它當成另一個 App（資料不會消失，只是新位置看不到）。

---

## 1. 技術選擇：可不可以直接用 Chrome 內建 PDF viewer？

| 方案 | 能不能用網頁程式控制標註？ | 結論 |
|---|---|---|
| **Chrome 內建 PDF viewer**（`<iframe>`/`<embed>` 開 PDF） | **不行。** 它是瀏覽器內部的 extension（PDFium），被隔離在另一個 process 裡。網頁拿不到它的 DOM、讀不到頁碼／縮放，也沒有 API 可以讀寫標註；使用者在裡面畫的東西只能用「另存」手動下載，程式拿不到。cross-origin 隔離也讓 `postMessage` 無法可靠控制它。 | ❌ 沒辦法拿來做「自動存每份的分數與標註」 |
| **瀏覽器原生 rendering**（`<object>`、`<embed>`） | 同上，只是換一種嵌入方式，底層還是同一個 viewer | ❌ |
| **PDF.js**（Mozilla，Firefox 內建的 viewer） | 可以。PDF 會畫在我們自己的 `<canvas>` 上，頁面大小、座標轉換、縮放、旋轉都拿得到，標註層可以完全自己控制 | ✅ **採用** |
| 商用 SDK（PSPDFKit/Nutrient、Apryse、Foxit Web） | 可以，功能完整 | 要授權費、體積大，部分需要伺服器；不符合 local-first、少依賴的需求 |
| 其他 open-source（react-pdf、pdf-annotate.js、EmbedPDF 等） | 大多是 PDF.js 或 PDFium-wasm 的包裝 | 自己在 PDF.js 上做標註層比較好控制座標與存檔格式 |

**最後的組合：**PDF.js 負責顯示 → 自己寫的 SVG 標註層 → 存到 IndexedDB → 匯出時用 **pdf-lib** 把標註畫進 PDF。

---

## 2. 架構

```
React 18 + TypeScript + Vite
│
├─ store/useStore.ts           Zustand：狀態、undo/redo、autosave（350 ms debounce）
├─ lib/storage/
│   ├─ StorageAdapter.ts       ← 儲存介面（以後要接後端 / Google Drive / OneDrive / Dropbox 只要再實作這個介面）
│   └─ IndexedDbAdapter.ts     ← v1 的實作（只存在本機）
├─ lib/pdfjs.ts                PDF.js 初始化、worker、內建 CMaps/字型、開檔 LRU 快取（目前 + 前後各 1 份）
├─ lib/exportPdf.ts            標註「壓平」寫入 PDF（pdf-lib）
├─ lib/exporters.ts            CSV、ZIP（fflate）、備份 / 還原
├─ components/
│   ├─ Sidebar.tsx             作業、匯入、檔案清單、分數、上下一份、進度、匯出
│   ├─ PdfViewer.tsx           捲動、只畫看得到的頁（lazy）、fit width / fit page、Ctrl+滾輪縮放
│   ├─ PdfPage.tsx             單頁 canvas（離開畫面就釋放記憶體）
│   ├─ AnnotationLayer.tsx     每頁一個 SVG 標註層（畫圖、選取、拖曳、橡皮擦、文字／便利貼編輯）
│   └─ Toolbar.tsx
└─ hooks/useShortcuts.ts       快捷鍵
```

Runtime 依賴只有 6 個：`react`、`react-dom`、`zustand`、`pdfjs-dist`、`pdf-lib`、`fflate`。

### 資料模型

```ts
GradedFile {               // 每份作業
  id, assignmentId, filename, studentName, size,
  score: number | null, maxScore,
  status: 'not_started' | 'in_progress' | 'graded',
  annotationCount, pageCount, viewRotation, importedAt, lastModified
}

Annotation {               // 每一個標註
  id, fileId, page,        // page 從 1 開始
  type: 'highlight' | 'underline' | 'strikethrough' | 'rectangle' | 'ellipse' | 'pen' | 'arrow' | 'text' | 'note',
  color, opacity, strokeWidth, createdAt, updatedAt,
  rect?   {x, y, width, height}   // highlight / underline / strikethrough / rectangle / ellipse
  points? [x0, y0, x1, y1, …]     // pen
  from?, to?                      // arrow
  x?, y?, text?, fontSize?        // text、note
}
```

**座標系統（最重要）：**標註座標用「頁面單位」：原點在頁面左上角（套用 PDF 自己的 `/Rotate` 之後），1 單位 = 1 PDF point（1/72 英吋）。
所以座標**跟縮放、螢幕解析度、檢視旋轉都無關**；匯出時用 `toPdfPoint()` 精準換回 PDF 座標（會處理 CropBox 與 `/Rotate`）。

範例（從 IndexedDB 實際讀出來的）：

```json
{ "id": "ann_aecac4f1-…", "fileId": "f_c3b0a2bf-…", "page": 1, "type": "rectangle",
  "rect": { "x": 61.5, "y": 141.45, "width": 123, "height": 30.75 },
  "color": "#d32f2f", "opacity": 1, "strokeWidth": 2,
  "createdAt": 1790925809969, "updatedAt": 1790925809969 }
```

---

## 3. 如何啟動 / Build（開發用）

需要 Node.js 18 以上（建議 20 或 22）。

```bash
npm install
npm run dev              # 開發模式 → http://localhost:5173
npm run build            # 一般版 → dist/（要用 http 伺服器開，例如 npm run preview）
npm run build:portable   # 單檔版 → dist-portable/index.html（可直接雙擊開啟）
npm run typecheck
```

Windows 也可以直接雙擊 `start-dev.bat`（第一次會自動 `npm install`）。

---

## 4. 如何使用

1. 左上角 **Open folder**（整個資料夾，含子資料夾）或 **Select files**，或直接把 PDF／資料夾**拖進視窗**。
2. 點清單上的學生，右邊顯示 PDF。
3. 用工具列標註（或快捷鍵）：
   `V` 選取/移動　`H` 螢光筆　`D` 畫筆　`T` 文字　`R` 方框　`O` 圓／橢圓　`A` 箭頭　`U` 底線　`K` 刪除線　`C` 便利貼評語　`E` 橡皮擦
4. 按 `S` 跳到分數欄 → 輸入分數 → **`Enter` = 存檔＋下一位**。
5. 全部改完：左下 **Export** → Grades (CSV) / Current graded PDF / All graded PDFs (ZIP)。

其他：
- **文字框**：選「文字」工具後，**點一下**＝文字框隨內容變寬；**拖曳**＝決定框的寬度，文字自動換行（中英文都可）。框是透明底、有外框；工具列的「文字框」按鈕可切換成沒有外框的純文字。選取文字框後拉右邊的小把手可以調整寬度。
- 選取標註後可以改顏色／粗細、拖曳移動、按 `Delete` 刪除；文字標註可雙擊修改。
- `Ctrl+Z` / `Ctrl+Shift+Z`（或 `Ctrl+Y`）復原／重做；每份作業各自保留復原紀錄（整個瀏覽 session 內）。
- `+` / `-` 縮放、`W` 符合寬度、`F` 符合頁面、`Ctrl+滾輪` 縮放、`PageUp/PageDown` 換頁、`Shift+R` 旋轉檢視（掃描歪掉的作業很好用）。
- `Ctrl+S` 立即存檔（其實一直都有 autosave）。按 `?` 看全部快捷鍵。
- 單鍵快捷鍵在你打字時（分數欄、學生名字、文字標註）不會觸發；瀏覽器原生的 `Ctrl+F`、`Ctrl +/−`、`Ctrl+P` 等不會被攔截。
- 「Show ungraded only」只顯示還沒給分的；排序可選檔名（自然排序：student2 在 student10 前面）、狀態、分數。
- 可以有多個作業（Assignment），左上角 `+` 新增，各自有滿分設定。

### 批改狀態
- **Not started**：沒分數也沒標註
- **In progress**：有標註但還沒給分
- **Graded**：已給分

---

## 5. 資料存在哪裡？

全部在瀏覽器的 **IndexedDB**（資料庫名稱 `pdf-grading-workspace`），在你的電腦上：

| Object store | 內容 |
|---|---|
| `assignments` | 作業名稱、滿分 |
| `files` | 每份作業的檔名、學生名、分數、狀態、最後修改時間 |
| `pdfs` | **原始 PDF 檔案（Blob），永遠不會被修改** |
| `annotations` | 每份 PDF 一筆：`{ fileId, annotations[], updatedAt }` |
| `settings` | 上次開的作業／檔案、工具顏色、排序 |

- 開啟時會請瀏覽器把資料標為「persistent」，避免空間不足時被自動清掉。
- 在 Chrome 可以從 DevTools → Application → IndexedDB 看到原始資料。
- 左下角會顯示**目前占用多少空間**（所有作業的 PDF 合計），旁邊的 **清除所有資料** 會永久刪除本工具存的所有 PDF、分數與標註（原始檔不受影響）。只想刪一部分：清單上檔名右側的 × 刪單份，左上角垃圾桶刪整個作業。
- 刪除後 Chrome 會在背景整理資料庫，硬碟空間可能要稍後（或重開瀏覽器後）才完全釋放。
- **清除瀏覽器的網站資料會把這些一起刪掉。**重要的批改請定期用 Export → **Save backup**（分數＋標註的 JSON，不含 PDF；匯入同樣的 PDF 後可用 Restore 還原）。

### PDF 如何保存
匯入時把檔案內容複製一份存進 IndexedDB（不是存路徑），所以原始檔之後搬走或刪掉也沒關係，也不會改到你硬碟上的原檔。

### Annotation 如何保存
每次畫完、修改、刪除，或改分數，350 ms 後自動寫入 IndexedDB；切換學生、關分頁、切到別的視窗時會立刻存。原始 PDF 跟標註是**分開**存的。

### 匯出時如何把標註寫進 PDF（flatten）
| 標註 | 寫進 PDF 的方式 |
|---|---|
| 螢光筆 | 半透明填色＋Multiply 混色（底下的字仍然清楚） |
| 方框、圓、畫筆、箭頭、底線、刪除線 | 向量線條（放大不會糊） |
| 文字 | 用系統字型畫成 4 倍解析度 PNG 再貼上 → **中文完全沒問題**，又不用把 10 MB 以上的中文字型包進 PDF |
| 便利貼評語 | 真正的 PDF 註解（Text annotation），在 Acrobat / Chrome / Edge 點圖示就能看到評語，中文用 UTF-16 存 |
| 分數 | 可選：在第 1 頁右上角蓋「87 / 100」（Export 裡可以關掉） |

如果你在檢視時旋轉過頁面，匯出的 PDF 也會套用同樣的旋轉。

---

## 6. 已測試的項目

用 Playwright（Chromium）自動測試，單檔版（file://）與 http 版都跑過：

| 測試 | 結果 |
|---|---|
| 匯入 10 份 PDF → 第一份顯示 | 0.4 秒 |
| 用資料夾匯入 50 份 | 0.5 秒 |
| 50 份只用鍵盤連續打分（輸入分數 → Enter → 下一份開好） | 平均每份 0.25 秒 |
| 300 頁 PDF | 0.3 秒開啟；捲到底時 DOM 裡只有 8 個 canvas（lazy render + 釋放） |
| 41 MB、40 頁的掃描檔 | 0.5 秒開啟，捲動時主執行緒最長卡 80 ms |
| 混合直式／橫式／`/Rotate 90` 頁面＋檢視旋轉 | 標註位置在畫面與匯出 PDF 中一致 |
| 9 種標註、undo/redo、移動、改色、刪除、橡皮擦、文字修改、便利貼新增/修改/刪除 | ✅ |
| 重新整理頁面、關掉瀏覽器再開 | 分數、標註、目前作業、上次開的檔案都還在 |
| 匯出 CSV（UTF-8 BOM，Excel 開中文不亂碼）、單份 PDF、53 份 ZIP | ✅（ZIP 2.4 秒） |
| 拖放匯入、分數超出範圍提示、打字時不觸發快捷鍵 | ✅ |

測試腳本放在 `tests/`（需要 Python + Playwright）。

---

## 7. 已知限制

- **資料只在這台電腦、這個瀏覽器裡**：換電腦／換瀏覽器看不到；清除網站資料會刪掉 → 請用 Save backup。
- **單檔版的資料跟檔案位置綁在一起**：建議固定從同一個位置開 `PDF批改工具.html`。
- 螢光筆是「拉框」式，不是像 Chrome 一樣選取文字（掃描檔沒有文字層，拉框兩種都適用）。
- 文字標註匯出後是圖片，不能在 Acrobat 裡再編輯或被搜尋到（評語可以用便利貼，它是真正的 PDF 註解）。
- PDF 搜尋（Ctrl+F 找 PDF 內文字）尚未實作；目前 `Ctrl+F` 會用瀏覽器原生的搜尋。
- 只能移動標註，還不能拉控制點改大小。
- 有密碼保護的 PDF 打不開；PDF 裡原本的表單、註解會照樣顯示，但不能編輯。
- 同一個作業裡「檔名＋檔案大小」完全相同的 PDF 會被當成重複而略過。
- 主要在 Chrome / Edge 測試；Firefox 應該可用，Safari 未測。

---

## 8. 下一步可以加的功能

- PDF 內文字搜尋（PDF.js text layer）＋選取文字式螢光筆
- 評分規準（rubric）面板：點選扣分項目自動加總、自動產生評語
- 常用評語庫（一鍵貼上「單位錯誤 −2」）
- 從 PDF 第一頁或檔名規則自動抓學號／姓名；匯入學生名冊對應
- 分數分佈圖、各題統計
- 標註控制點縮放、複製貼上、多選
- 用 File System Access API 直接把 graded PDF 寫回指定資料夾
- 雲端同步：實作 `StorageAdapter`（Google Drive / OneDrive / Dropbox / 自架後端）
- PWA 安裝成桌面 App
