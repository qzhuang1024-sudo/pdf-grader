import glob, os, base64, sys
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///home/claude/pdf-grader/dist-portable/index.html'
files = sorted(glob.glob('/home/claude/testpdfs/set50/*.pdf'))[:6]
payload = [{'name': os.path.basename(f), 'b64': base64.b64encode(open(f,'rb').read()).decode()} for f in files]
JS = '''([files, mode]) => {
  const mk = f => new File([Uint8Array.from(atob(f.b64), c => c.charCodeAt(0))], f.name, {type: 'application/pdf'});
  const dt = new DataTransfer();
  dt.items.add(mk(files[0]));                         // a plain PDF file
  if (mode !== 'files') {
    dt.items.add(new File([], 'HW1-folder'));          // placeholder item representing a dropped folder
    const inside = files.slice(1, 4).map(mk);
    const orig = DataTransferItem.prototype.webkitGetAsEntry;
    DataTransferItem.prototype.webkitGetAsEntry = function () {
      const f = this.getAsFile();
      if (f && f.name === 'HW1-folder') {
        return { isFile: false, isDirectory: true, name: 'HW1-folder', createReader() {
          let done = false;
          return { readEntries(ok, err) {
            if (mode === 'folder-blocked') return err(new DOMException('blocked', 'SecurityError'));
            if (done) return ok([]);
            done = true;
            ok(inside.map(x => ({ isFile: true, isDirectory: false, name: x.name, file: (cb) => cb(x) })));
          } };
        } };
      }
      return orig.call(this);
    };
  } else {
    for (const f of files.slice(1)) dt.items.add(mk(f));
  }
  const t = document.querySelector('.viewer');
  for (const type of ['dragenter', 'dragover', 'drop']) t.dispatchEvent(new DragEvent(type, {dataTransfer: dt, bubbles: true, cancelable: true}));
}'''
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    for mode, expect in [('files', 6), ('folder-ok', 4), ('folder-blocked', 1)]:
        page = br.new_context().new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.goto(URL); page.wait_for_selector('.sidebar')
        page.evaluate(JS, [payload, mode])
        page.wait_for_timeout(1500)
        n = page.locator('.file-item').count()
        print(f'{mode}: imported {n} (expected {expect}) | toasts: {page.locator(".toast").all_inner_texts()} | errors {errs}')
    br.close()
