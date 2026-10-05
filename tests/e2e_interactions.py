import sys, os, glob, json, shutil
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///home/claude/pdf-grader/dist-portable/index.html'
OUT = '/home/claude/testout'
errors = []
def count(page, n=1): return page.locator(f'.page[data-page="{n}"] .ann').count()
with sync_playwright() as p:
    br = p.chromium.launch(headless=True); page = br.new_page(viewport={'width': 1366, 'height': 768})
    page.on('console', lambda m: m.type in ('error','warning') and 'MSung' not in m.text and errors.append(f'[{m.type}] {m.text[:300]}'))
    page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
    page.add_init_script("try{localStorage.setItem('pgw.guideSeen','1')}catch(e){}"); page.goto(URL); page.wait_for_selector('.sidebar')
    # synthetic drag & drop of two PDFs
    import base64
    files = sorted(glob.glob('/home/claude/testpdfs/set50/*.pdf'))[:2]
    payload = [{'name': os.path.basename(f), 'b64': base64.b64encode(open(f,'rb').read()).decode()} for f in files]
    page.evaluate('''(files) => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), c => c.charCodeAt(0))], f.name, {type: 'application/pdf'}));
      const target = document.querySelector('.app');
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, {dataTransfer: dt, bubbles: true, cancelable: true}));
    }''', payload)
    page.wait_for_function("document.querySelectorAll('.file-item').length === 2", timeout=15000)
    page.wait_for_selector('.page-canvas')
    print('drag&drop import OK')
    b = page.locator('.page[data-page="1"]').bounding_box()
    # draw 3 rects
    page.keyboard.press('r')
    for i in range(3):
        page.mouse.move(b['x']+100, b['y']+150+i*80); page.mouse.down(); page.mouse.move(b['x']+300, b['y']+200+i*80, steps=3); page.mouse.up()
    print('rects:', count(page))
    # eraser drag across the stroke of first two rects (left edge x=100)
    page.keyboard.press('e')
    page.mouse.move(b['x']+100, b['y']+140); page.mouse.down(); page.mouse.move(b['x']+100, b['y']+290, steps=15); page.mouse.up()
    print('after eraser drag:', count(page))
    page.keyboard.press('Control+z'); page.keyboard.press('Control+z')
    print('after 2x undo:', count(page))
    # select & recolor & delete via keyboard
    page.keyboard.press('v')
    page.mouse.click(b['x']+100, b['y']+175)
    print('selected box visible:', page.locator('.ann-layer rect[stroke="#1a73e8"]').count())
    page.locator('.swatch').nth(1).click()  # blue
    print('rect color now:', page.locator('.page[data-page="1"] .ann rect[stroke]:not(.hit)').first.get_attribute('stroke'))
    page.keyboard.press('Delete')
    print('after Delete:', count(page))
    # text: create, double-click edit, verify
    page.keyboard.press('t'); page.mouse.click(b['x']+400, b['y']+120)
    page.wait_for_selector('.text-editor'); page.keyboard.type('Check units'); page.mouse.click(b['x']+600, b['y']+600)  # blur commits
    page.wait_for_timeout(200)
    page.keyboard.press('v')
    t = page.locator('.page[data-page="1"] text').first; tb = t.bounding_box()
    page.mouse.dblclick(tb['x']+5, tb['y']+5)
    page.wait_for_selector('.text-editor'); page.keyboard.press('End'); page.keyboard.type(' (kg?)'); page.keyboard.press('Escape')
    print('text now:', page.locator('.page[data-page="1"] text').first.text_content())
    # note: create, reopen, delete
    page.keyboard.press('c'); page.mouse.click(b['x']+700, b['y']+300)
    page.wait_for_selector('.note-popup'); page.keyboard.type('Nice derivation'); page.click('.note-popup .btn.primary')
    n_before = count(page)
    page.keyboard.press('v'); page.mouse.click(b['x']+700, b['y']+300)
    page.wait_for_selector('.note-popup'); print('note reopened with:', page.locator('.note-popup textarea').input_value())
    page.click('.note-popup .btn.danger'); page.wait_for_timeout(200)
    print('note deleted:', n_before, '->', count(page))
    # empty note / empty text are discarded
    page.keyboard.press('t'); page.mouse.click(b['x']+400, b['y']+500); page.wait_for_selector('.text-editor'); page.keyboard.press('Escape')
    print('empty text discarded, count:', count(page))
    # undo history survives switching files
    page.keyboard.press('v')
    page.keyboard.press('n'); page.wait_for_timeout(500); page.keyboard.press('p'); page.wait_for_timeout(500)
    before = count(page); page.keyboard.press('Control+z'); print('undo after switching back:', before, '->', count(page))
    # shortcuts must not fire while typing in the student name
    page.locator('.student-name').click(); page.keyboard.press('End'); page.keyboard.type(' nr'); 
    print('student name:', page.locator('.student-name').input_value(), '| tool still:', page.locator('.icon-btn.tool.active').get_attribute('title'))
    page.wait_for_timeout(600)
    # stored annotation JSON
    data = page.evaluate('''() => new Promise(res => { const r = indexedDB.open('pdf-grading-workspace'); r.onsuccess = () => {
        const tx = r.result.transaction('annotations'); const q = tx.objectStore('annotations').getAll(); q.onsuccess = () => res(q.result); }; })''')
    for d in data:
        if d['annotations']:
            print('stored sample:', json.dumps(d['annotations'][0], ensure_ascii=False))
            break
    # invalid score
    page.keyboard.press('Escape'); page.locator('.viewer-scroll').click(position={'x':3,'y':3})
    page.keyboard.press('s'); page.keyboard.type('120'); print('invalid shown:', page.locator('.score-row.invalid').count(), page.locator('.score-hint').inner_text())
    page.keyboard.press('Control+a'); page.keyboard.type('88.25'); page.keyboard.press('Tab')
    page.locator('.viewer-scroll').click(position={'x':3,'y':3}); page.keyboard.press('Shift+?'); page.wait_for_timeout(200)
    page.screenshot(path=f'{OUT}/20_help.png'); page.keyboard.press('Shift+?')
    page.screenshot(path=f'{OUT}/21_final.png')
    br.close()
print('ERRORS:', json.dumps(errors, ensure_ascii=False, indent=1)[:2000])
