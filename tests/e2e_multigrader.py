import glob, sys
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///home/claude/pdf-grader/dist-portable/index.html'
OUT = '/home/claude/testout'
PDFS = sorted(glob.glob('/home/claude/testpdfs/set50/*.pdf'))[:3]
errors = []; dialogs = []
answer = {'accept': True}

def on_dialog(d):
    dialogs.append(d.message.replace('\n', ' | '))
    d.accept() if answer['accept'] else d.dismiss()

def open_app(br, h=900):
    page = br.new_context(viewport={'width': 1440, 'height': h}, accept_downloads=True).new_page()
    page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', on_dialog)
    page.add_init_script("try{localStorage.setItem('pgw.guideSeen','1')}catch(e){}"); page.goto(URL); page.wait_for_selector('.sidebar')
    page.locator('input[type=file][accept*=pdf]').set_input_files(PDFS)
    page.wait_for_function("document.querySelectorAll('.file-item').length === 3"); page.wait_for_selector('.page-canvas')
    return page

def setup_graders(page):
    page.select_option('.grader-row-head select', '2'); page.wait_for_selector('.grader-edit-row')
    n = page.locator('.grader-name-input'); m = page.locator('.grader-max-input')
    n.nth(0).fill('王老師'); n.nth(0).press('Enter'); n.nth(1).fill('李助教'); n.nth(1).press('Enter')
    m.nth(0).fill('60'); m.nth(0).press('Enter'); m.nth(1).fill('40'); m.nth(1).press('Enter'); page.wait_for_timeout(300)

def grade_slot(page, slot, scores):
    page.locator('.file-item').first.click(); page.wait_for_timeout(300)
    page.locator(f'#score-input-{slot}').click()
    for v in scores:
        page.keyboard.type(str(v)); page.keyboard.press('Enter'); page.wait_for_timeout(350)

def annotate(page, y, note=None):
    page.locator('.file-item').first.click(); page.wait_for_timeout(400)
    b = page.locator('.page[data-page="1"]').bounding_box()
    page.keyboard.press('Escape'); page.locator('.viewer-scroll').click(position={'x': 3, 'y': 3})
    page.keyboard.press('r'); page.mouse.move(b['x']+100, b['y']+y); page.mouse.down(); page.mouse.move(b['x']+300, b['y']+y+40, steps=3); page.mouse.up()
    if note:
        page.keyboard.press('c'); page.mouse.click(b['x']+700, b['y']+y); page.wait_for_selector('.note-popup')
        page.keyboard.type(note); page.click('.note-popup .btn.primary')
    page.keyboard.press('v')

def backup(page, name):
    page.click('.export-toggle')
    with page.expect_download() as d: page.click('button:has-text("Save backup")')
    path = f'{OUT}/{name}'; d.value.save_as(path); page.click('.export-toggle'); return path

with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    # ── grader 1 (王老師) computer
    a = open_app(br); setup_graders(a)
    print('A who am I:', a.locator('.whoami select option:checked').inner_text(), '| toolbar chip:', a.locator('.tb-grader').inner_text())
    grade_slot(a, 0, [50, 45, 58]); annotate(a, 150, note='請補單位')
    # locked slot of the other grader
    a.locator('.file-item').first.click(); a.wait_for_timeout(300)
    a.locator('#score-input-1').click(); a.keyboard.type('99'); a.wait_for_timeout(200)
    print('typing in locked slot ->', repr(a.locator('#score-input-1').input_value()), '| readonly:', a.locator('#score-input-1').get_attribute('readonly') is not None)
    answer['accept'] = False; a.locator('.lock-btn').first.click(); a.wait_for_timeout(200)
    print('unlock cancelled -> still locked:', a.locator('.score-row.locked').count() == 1)
    answer['accept'] = True; a.locator('.lock-btn').first.click(); a.wait_for_timeout(200)
    print('unlock dialog:', dialogs[-1][:60], '| warning:', a.locator('.lock-warning').inner_text())
    a.locator('#score-input-1').fill(''); a.wait_for_timeout(200)  # leave it empty
    a.locator('.file-item').nth(1).click(); a.wait_for_timeout(300)
    print('relocked after switching student:', a.locator('.score-row.locked').count() == 1)
    a.locator('.file-item').first.click(); a.wait_for_timeout(500)
    print('annotation tooltip:', a.locator('.page[data-page="1"] .ann > title').first.text_content())
    bA = backup(a, 'backup_A.json')
    # ── grader 2 (李助教) computer
    b = open_app(br); setup_graders(b)
    b.select_option('.whoami select', 'g2'); b.wait_for_timeout(200)
    grade_slot(b, 1, [30, 35, 22]); annotate(b, 300)
    # deleting 0 others' annotations here; check the warning on deleting a foreign one later at coordinator
    bB = backup(b, 'backup_B.json')
    # ── coordinator: has typed a different score for 李助教 on student01 already
    c = open_app(br); setup_graders(c); c.select_option('.whoami select', 'g2')
    c.locator('.file-item').first.click(); c.wait_for_timeout(300); c.locator('#score-input-1').fill('33'); c.wait_for_timeout(500)
    c.select_option('.whoami select', 'g1')
    c.click('.export-toggle')
    answer['accept'] = False   # → keep this computer's score on conflict
    c.locator('input[type=file][accept*=json]').set_input_files([bA, bB])
    # one dialog per backup; defaults: A → 王老師, B → 李助教 (matched by name), conflicts → keep
    for _ in range(2):
        c.wait_for_selector('.import-dialog'); c.wait_for_timeout(400)
        print('dialog:', c.locator('.import-file strong').inner_text(), '|', c.locator('.import-field select').nth(0).locator('option:checked').inner_text(),
              '→', c.locator('.import-field select').nth(1).locator('option:checked').inner_text(),
              '| conflict:', c.locator('.import-conflict').count())
        c.click('.import-actions .btn.primary'); c.wait_for_timeout(600)
    c.wait_for_selector('.toast.success'); c.wait_for_timeout(400)
    print('merge toast:', c.locator('.toast.success').last.inner_text())
    c.locator('.file-item').first.click(); c.wait_for_timeout(500)
    print('student01 slots (kept 33):', [c.locator(f'#score-input-{i}').input_value() for i in range(2)], '|', c.locator('.score-total').inner_text().replace('\n', ' '))
    # deleting another grader's annotation asks first
    answer['accept'] = False
    b1 = c.locator('.page[data-page="1"]').bounding_box()
    c.keyboard.press('Escape'); c.locator('.viewer-scroll').click(position={'x': 3, 'y': 3}); c.keyboard.press('v')
    c.mouse.click(b1['x']+100, b1['y']+320)  # 李助教's rectangle (left edge)
    c.wait_for_timeout(200)
    print('selection label:', c.locator('.ann-layer text').last.text_content())
    n0 = c.locator('.page[data-page="1"] .ann').count(); c.keyboard.press('Delete'); c.wait_for_timeout(200)
    print('delete foreign annotation cancelled:', n0, '->', c.locator('.page[data-page="1"] .ann').count(), '|', dialogs[-1][:40])
    answer['accept'] = True
    c.locator('.file-item').nth(1).click(); c.wait_for_timeout(300); c.locator('.file-item').first.click(); c.wait_for_timeout(500)
    with c.expect_download() as d: c.click('text=Current graded PDF')
    d.value.save_as(f'{OUT}/multi_graded.pdf')
    c.screenshot(path=f'{OUT}/53_locks.png')
    br.close()
print('errors:', errors)
