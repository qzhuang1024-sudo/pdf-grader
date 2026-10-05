import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Open the user guide from anywhere: openGuide() or openGuide('multi'). */
export function openGuide(section?: string) {
  window.dispatchEvent(new CustomEvent('pgw:guide', { detail: section }));
}

interface Section {
  id: string;
  title: string;
  body: ReactNode;
}

const K = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>;

const SECTIONS: Section[] = [
  {
    id: 'start',
    title: '快速開始',
    body: (
      <>
        <ol>
          <li>左上角按 <b>Open folder</b>（整個資料夾）或 <b>Select files</b>，也可以直接把 PDF 拖進視窗。</li>
          <li>點左邊清單的學生，右邊會顯示 PDF。</li>
          <li>用上方工具列在 PDF 上標註（畫線、框、螢光筆、文字框、評語…）。</li>
          <li>按 <K>S</K> 跳到分數格，輸入分數後按 <K>Enter</K>：自動存檔並開下一位學生。</li>
          <li>全部改完：左下 <b>Export and Import</b> → 匯出成績 CSV 或批改後的 PDF（ZIP）。</li>
        </ol>
        <p className="tip">不用按存檔：分數與標註都會自動儲存在這台電腦的瀏覽器裡。</p>
      </>
    ),
  },
  {
    id: 'annotate',
    title: '標註工具',
    body: (
      <>
        <table className="guide-table">
          <tbody>
            <tr><td><K>V</K></td><td>選取 / 移動：點標註選取，拖曳移動，<K>Delete</K> 刪除，雙擊文字可修改</td></tr>
            <tr><td><K>H</K></td><td>螢光筆：拉一個範圍</td></tr>
            <tr><td><K>D</K></td><td>畫筆：手寫、打勾、圈選</td></tr>
            <tr><td><K>T</K></td><td>文字框：<b>點一下</b>＝隨內容變寬；<b>拖曳</b>＝設定寬度、自動換行。透明底、可切換有無外框；選取後拉右邊小把手調寬度</td></tr>
            <tr><td><K>R</K> / <K>O</K> / <K>A</K></td><td>方框 / 圓 / 箭頭</td></tr>
            <tr><td><K>U</K> / <K>K</K></td><td>底線 / 刪除線</td></tr>
            <tr><td><K>C</K></td><td>便利貼評語：點一下放置，寫給學生的評語（匯出後是 PDF 註解，點圖示可看）</td></tr>
            <tr><td><K>E</K></td><td>橡皮擦：點一下或拖過標註刪除</td></tr>
          </tbody>
        </table>
        <p>工具列右側可以換顏色與粗細；選取某個標註時，改的是那個標註。<K>Ctrl</K>+<K>Z</K> 復原、<K>Ctrl</K>+<K>Shift</K>+<K>Z</K> 重做。</p>
        <p>縮放：<K>+</K> / <K>-</K>、<K>Ctrl</K>+滾輪、<K>W</K> 符合寬度、<K>F</K> 符合頁面。掃描歪掉的作業可按 <K>Shift</K>+<K>R</K> 旋轉檢視。</p>
      </>
    ),
  },
  {
    id: 'score',
    title: '打分數',
    body: (
      <>
        <ul>
          <li>分數格可輸入整數或小數，範圍 0 ～ 滿分。超出範圍會變紅，不會存。</li>
          <li><K>Enter</K>＝存檔並開下一位；<K>N</K> / <K>P</K>＝下一位 / 上一位（不在輸入框時）。</li>
          <li>狀態：<b>Not started</b>（沒分數也沒標註）、<b>In progress</b>（有標註或部分批改者已給分）、<b>Graded</b>（全部分數都填了）。</li>
          <li>「Show ungraded only」只顯示還沒改完的；排序可選檔名、狀態、分數。</li>
          <li>分數格右上角 <b>Aa</b>：調整分數字體大小（小／中／大）、文字與背景顏色，有幾組預設配色。</li>
          <li>滿分在左上角「Max score」設定；可以有多個作業（Assignment），左上角 <b>+</b> 新增。</li>
        </ul>
      </>
    ),
  },
  {
    id: 'multi',
    title: '多人批改',
    body: (
      <>
        <ol>
          <li><b>設定</b>：左上角「批改者」選人數，按「設定」填每位批改者的名字與滿分（總分＝各人分數相加）。大家要用<b>相同的順序</b>。</li>
          <li><b>我是誰</b>：分數區上方「我是」選自己的格子（名字在左上角「批改者 → 設定」填寫）。之後畫的標註都會記錄是你畫的；只有你的分數格可以輸入。</li>
          <li><b>各自批改</b>：每個人在自己的電腦匯入同一批 PDF，只填自己那一格。</li>
          <li><b>交出 backup</b>：改完按 Export and Import → <b>Save backup</b>，把 .json 檔交給彙整的人。</li>
          <li><b>彙整</b>：彙整的人匯入同一批 PDF，按 Open folder 下方的 <b>「匯入 Backup（.json）」</b>，每個 backup 會跳出視窗，選「這份是哪位批改者的」與「匯入到這裡的哪位批改者」，確認預覽後匯入。</li>
        </ol>
        <p><b>防止改到別人的成績</b>：其他人的分數格是鎖住的 🔒。點 🔒 會先警告，確認後才可修改；換下一位學生會自動重新鎖上。刪除別人畫的標註會先詢問，橡皮擦拖過去不會擦掉別人的標註。匯入 backup 時若分數與這裡不同，預設保留這台電腦的分數。</p>
        <p>匯出的 CSV 每位批改者一欄，<code>score</code> 欄是總分；PDF 第 1 頁的分數章會列出每個人的分數。</p>
      </>
    ),
  },
  {
    id: 'export',
    title: '匯出與匯入',
    body: (
      <>
        <p>左下 <b>Export and Import</b>：</p>
        <ul>
          <li><b>Grades (CSV)</b>：成績表，Excel 可直接開（中文不亂碼），時間是本機時間。</li>
          <li><b>Current graded PDF</b>：只匯出目前這位學生批改後的 PDF。</li>
          <li><b>All graded PDFs (ZIP)</b>：全部學生，每人一個 <code>檔名_graded.pdf</code>。</li>
          <li><b>Stamp score on page 1</b>：在第 1 頁右上角蓋分數；不想讓學生在 PDF 上看到分數就取消勾選。</li>
          <li><b>Save backup / Import backup</b>：分數＋標註的 .json（不含 PDF），用來備份、搬到另一台電腦、或合併其他批改者的成績。</li>
        </ul>
        <p>發還給學生：把 ZIP 解壓縮，透過 NTU COOL／Email 等管道<b>一人一份</b>發給同學，不要把整個資料夾分享給全班。</p>
      </>
    ),
  },
  {
    id: 'data',
    title: '資料儲存與隱私',
    body: (
      <>
        <ul>
          <li>所有 PDF、分數、標註都只存在<b>這台電腦的這個瀏覽器</b>（IndexedDB），不會上傳到任何伺服器，也不會傳給 AI。</li>
          <li>匯入時瀏覽器可能顯示「上傳」字樣，那是瀏覽器的固定用語，檔案其實沒有離開你的電腦。</li>
          <li>原始 PDF 不會被修改；只有匯出時才把標註畫進新的 PDF。</li>
          <li>換電腦、換瀏覽器看不到之前的資料；清除瀏覽器網站資料會一起刪掉。請定期 <b>Save backup</b>。</li>
          <li>左下角顯示目前占用空間；刪單份按檔名旁的 ×，刪整個作業按左上角垃圾桶，全部清空按「清除所有資料」。</li>
          <li>請固定從同一個位置開啟 <code>PDF批改工具.html</code>，並使用 Chrome 或 Edge。</li>
        </ul>
      </>
    ),
  },
  {
    id: 'faq',
    title: '常見問題',
    body: (
      <>
        <p><b>拖資料夾進來沒反應？</b> 用雙擊開啟的頁面，Chrome 可能不允許讀取拖進來的資料夾。請改用 <b>Open folder</b>，或打開資料夾全選 PDF 後再拖。</p>
        <p><b>左側面板顯示不完整？</b> 左側可以上下捲動；中間的分隔線可以左右拖曳調整寬度。</p>
        <p><b>不小心刪錯標註？</b> 按 <K>Ctrl</K>+<K>Z</K> 復原（每份作業各自有復原紀錄）。</p>
        <p><b>快捷鍵在打字時不會觸發嗎？</b> 對，在分數格、名字、文字框輸入時，單鍵快捷鍵不會作用。按 <K>?</K> 可看全部快捷鍵。</p>
      </>
    ),
  },
];

export function GuideDialog({ initial, onClose, onShowShortcuts }: { initial?: string; onClose: () => void; onShowShortcuts: () => void }) {
  const [active, setActive] = useState(initial && SECTIONS.some((s) => s.id === initial) ? initial : 'start');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [active]);

  const sec = SECTIONS.find((s) => s.id === active)!;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal guide" role="dialog" aria-label="使用說明" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>使用說明</h3>
          <button className="link-btn" onClick={onClose}>關閉</button>
        </div>
        <div className="guide-layout">
          <nav className="guide-nav">
            {SECTIONS.map((s) => (
              <button key={s.id} className={s.id === active ? 'on' : ''} onClick={() => setActive(s.id)}>{s.title}</button>
            ))}
            <button onClick={() => { onClose(); onShowShortcuts(); }}>快捷鍵一覽 ⌨</button>
          </nav>
          <div className="guide-body" ref={bodyRef}>
            <h4>{sec.title}</h4>
            {sec.body}
          </div>
        </div>
      </div>
    </div>
  );
}
