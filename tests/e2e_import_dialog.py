import glob, sys
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///home/claude/pdf-grader/dist-portable/index.html'
OUT = '/home/claude/testout'
PDFS = sorted(glob.glob('/home/claude/testpdfs/set50/*.pdf'))[:3]
errors = []

def open_app(br):
    page = br.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True).new_page()
    page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda d: d.accept())
    page.add_init_script("try{localStorage.setItem('pgw.guideSeen','1')}catch(e){}"); page.goto(URL); page.wait_for_selector('.sidebar')
    page.locator('input[type=file][accept*=pdf]').set_input_files(PDFS)
    page.wait_for_function("document.querySelectorAll('.file-item').length === 3"); page.wait_for_selector('.page-canvas')
    return page

def single_grader_session(br, scores, y, name):
    """a grader who never set up multiple graders: just types scores in the only box"""
    p = open_app(br)
    p.locator('.file-item').first.click(); p.locator('#score-input-0').click()
    for v in scores:
        p.keyboard.type(str(v)); p.keyboard.press('Enter'); p.wait_for_timeout(300)
    p.locator('.file-item').first.click(); p.wait_for_timeout(300)
    b = p.locator('.page[data-page="1"]').bounding_box()
    p.keyboard.press('Escape'); p.locator('.viewer-scroll').click(position={'x': 3, 'y': 3})
    p.keyboard.press('r'); p.mouse.move(b['x']+100, b['y']+y); p.mouse.down(); p.mouse.move(b['x']+300, b['y']+y+40, steps=3); p.mouse.up()
    p.wait_for_timeout(500)
    p.click('.export-toggle')
    with p.expect_download() as d: p.click('button:has-text("Save backup")')
    path = f'{OUT}/{name}'; d.value.save_as(path); return path

with sync_playwright() as pw:
    br = pw.chromium.launch(headless=True)
    bA = single_grader_session(br, [50, 45, 58], 150, 'single_A.json')
    bB = single_grader_session(br, [30, 35, 22], 300, 'single_B.json')
    c = open_app(br)
    c.select_option('.grader-row-head select', '2'); c.wait_for_selector('.grader-edit-row')
    n = c.locator('.grader-name-input'); m = c.locator('.grader-max-input')
    n.nth(0).fill('王老師'); n.nth(0).press('Enter'); n.nth(1).fill('李助教'); n.nth(1).press('Enter')
    m.nth(0).fill('60'); m.nth(0).press('Enter'); m.nth(1).fill('40'); m.nth(1).press('Enter'); c.wait_for_timeout(300)
    c.click('.export-toggle')
    c.locator('input[type=file][accept*=json]').set_input_files([bA, bB])
    # dialog 1: A → 王老師 (default target guess: same position = g1 王老師)
    c.wait_for_selector('.import-dialog'); c.wait_for_timeout(300)
    print('dialog 1 file:', c.locator('.import-file strong').inner_text(), '| from:', c.locator('.import-field select').nth(0).locator('option:checked').inner_text(),
          '| to:', c.locator('.import-field select').nth(1).locator('option:checked').inner_text())
    print('preview:', c.locator('.import-preview').inner_text().replace('\n', ' '))
    c.screenshot(path=f'{OUT}/60_import_dialog.png')
    c.click('.import-actions .btn.primary')
    # dialog 2: B → choose 李助教
    c.wait_for_function("document.querySelector('.import-file strong')?.textContent === 'single_B.json'")
    c.locator('.import-field select').nth(1).select_option('g2'); c.wait_for_timeout(300)
    print('dialog 2 warn:', c.locator('.import-dialog .lock-warning').all_inner_texts())
    print('preview 2:', c.locator('.import-preview').inner_text().replace('\n', ' '))
    c.click('.import-actions .btn.primary')
    c.wait_for_selector('.toast.success'); c.wait_for_timeout(500)
    print('toast:', c.locator('.toast.success').last.inner_text())
    print('list:', [t.replace('\n', ' ') for t in c.locator('.file-item').all_inner_texts()])
    c.locator('.file-item').first.click(); c.wait_for_timeout(500)
    print('slots:', [c.locator(f'#score-input-{i}').input_value() for i in range(2)])
    print('annotation authors:', c.locator('.page[data-page="1"] .ann > title').all_text_contents())
    # re-import A into the WRONG slot (李助教) → conflicts shown, keep by default
    c.locator('input[type=file][accept*=json]').set_input_files([bA])
    c.wait_for_selector('.import-dialog'); c.locator('.import-field select').nth(1).select_option('g2'); c.wait_for_timeout(400)
    print('conflict box:', c.locator('.import-conflict').inner_text().replace('\n', ' | '))
    c.click('.import-actions .btn.primary'); c.wait_for_timeout(800)
    c.locator('.file-item').nth(1).click(); c.wait_for_timeout(200); c.locator('.file-item').first.click(); c.wait_for_timeout(400)
    print('slots after keep:', [c.locator(f'#score-input-{i}').input_value() for i in range(2)])
    # cancel path
    c.locator('input[type=file][accept*=json]').set_input_files([bB])
    c.wait_for_selector('.import-dialog'); c.click('.import-actions .btn:not(.primary)'); c.wait_for_timeout(500)
    print('cancel toast:', c.locator('.toast').last.inner_text()); c.locator('.file-item').nth(1).click(); c.wait_for_timeout(200); c.locator('.file-item').first.click(); c.wait_for_timeout(400); print('authors after wrong-slot re-import:', c.locator('.page[data-page="1"] .ann > title').all_text_contents())
    br.close()
print('errors:', errors)
