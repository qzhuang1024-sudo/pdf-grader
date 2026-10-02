import sys, os, glob, time, json, shutil
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///home/claude/pdf-grader/dist-portable/index.html'
OUT = '/home/claude/testout'; os.makedirs(OUT, exist_ok=True)
PROFILE = '/home/claude/pw-profile'; shutil.rmtree(PROFILE, ignore_errors=True)
files = sorted(glob.glob('/home/claude/testpdfs/set50/*.pdf'))[:10]
errors = []

def launch(p):
    ctx = p.chromium.launch_persistent_context(PROFILE, headless=True, viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.on('console', lambda m: m.type in ('error', 'warning') and errors.append(f'[{m.type}] {m.text}'))
    page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
    page.goto(URL)
    page.wait_for_selector('.sidebar', timeout=20000)
    return ctx, page

def page_box(page, n=1):
    return page.locator(f'.page[data-page="{n}"]').bounding_box()

with sync_playwright() as p:
    ctx, page = launch(p)
    t0 = time.time()
    page.locator('input[type=file][multiple]').set_input_files(files)
    page.wait_for_selector('.page-canvas', timeout=30000)
    print('import+first render: %.2fs' % (time.time()-t0))
    page.wait_for_timeout(500)
    page.screenshot(path=f'{OUT}/01_loaded.png')
    b = page_box(page, 1)
    # pen
    page.keyboard.press('d')
    page.mouse.move(b['x']+100, b['y']+200); page.mouse.down()
    for i in range(20): page.mouse.move(b['x']+100+i*8, b['y']+200+ (10 if i%2 else -10))
    page.mouse.up()
    # highlight
    page.keyboard.press('h')
    page.mouse.move(b['x']+80, b['y']+250); page.mouse.down(); page.mouse.move(b['x']+400, b['y']+268, steps=5); page.mouse.up()
    # rectangle
    page.keyboard.press('r')
    page.mouse.move(b['x']+450, b['y']+300); page.mouse.down(); page.mouse.move(b['x']+650, b['y']+380, steps=5); page.mouse.up()
    # ellipse + arrow + underline + strike
    page.keyboard.press('o'); page.mouse.move(b['x']+100, b['y']+420); page.mouse.down(); page.mouse.move(b['x']+220, b['y']+470, steps=4); page.mouse.up()
    page.keyboard.press('a'); page.mouse.move(b['x']+300, b['y']+520); page.mouse.down(); page.mouse.move(b['x']+450, b['y']+460, steps=4); page.mouse.up()
    page.keyboard.press('u'); page.mouse.move(b['x']+80, b['y']+540); page.mouse.down(); page.mouse.move(b['x']+300, b['y']+556, steps=4); page.mouse.up()
    page.keyboard.press('k'); page.mouse.move(b['x']+80, b['y']+580); page.mouse.down(); page.mouse.move(b['x']+300, b['y']+596, steps=4); page.mouse.up()
    # text
    page.keyboard.press('t'); page.mouse.click(b['x']+500, b['y']+150)
    page.wait_for_selector('.text-editor', timeout=5000); page.keyboard.type('很好! Good work'); page.keyboard.press('Enter'); page.keyboard.type('第二行 -2')
    page.keyboard.press('Escape')
    # note
    page.keyboard.press('c'); page.mouse.click(b['x']+700, b['y']+220)
    page.wait_for_selector('.note-popup textarea'); page.keyboard.type('請說明單位 (units?)'); page.click('.note-popup .btn.primary')
    page.keyboard.press('v')
    n_ann = page.locator('.page[data-page="1"] .ann').count()
    print('annotations drawn on p1:', n_ann)
    # undo / redo
    page.keyboard.press('Control+z'); a1 = page.locator('.ann').count()
    page.keyboard.press('Control+Shift+z'); a2 = page.locator('.ann').count()
    print('undo/redo counts:', a1, a2)
    # move an annotation with select tool: drag the rectangle
    page.mouse.move(b['x']+450, b['y']+340); page.mouse.down(); page.mouse.move(b['x']+480, b['y']+360, steps=4); page.mouse.up()
    page.screenshot(path=f'{OUT}/02_annotated.png')
    # score + Enter → next
    page.keyboard.press('s'); page.keyboard.type('87.5'); page.keyboard.press('Enter')
    page.wait_for_timeout(800)
    print('current after Enter:', page.locator('.file-item.active .fname').inner_text())
    page.keyboard.type('92'); page.keyboard.press('Enter'); page.wait_for_timeout(600)
    # N / P navigation from body
    page.locator('.viewer-scroll').click(position={'x': 5, 'y': 5})
    page.keyboard.press('n'); page.wait_for_timeout(500)
    print('after N:', page.locator('.file-item.active .fname').inner_text())
    page.keyboard.press('p'); page.wait_for_timeout(500)
    print('after P:', page.locator('.file-item.active .fname').inner_text())
    print('progress:', page.locator('.progress-row').inner_text())
    page.screenshot(path=f'{OUT}/03_after_grading.png')

    # zoom / fit
    page.keyboard.press('+'); page.keyboard.press('+'); page.wait_for_timeout(400)
    print('zoom label:', page.locator('.zoom-label').inner_text())
    page.keyboard.press('f'); page.wait_for_timeout(400)
    print('fit page zoom:', page.locator('.zoom-label').inner_text())
    page.keyboard.press('w'); page.wait_for_timeout(300)

    # refresh persistence
    page.reload(); page.wait_for_selector('.file-item'); page.wait_for_timeout(800)
    items = page.locator('.file-item').all_inner_texts()
    print('after reload:', [i.replace('\n',' ') for i in items[:4]])
    page.locator('.file-item').nth(0).click(); page.wait_for_selector('.page-canvas'); page.wait_for_timeout(500)
    print('annotations after reload (file1):', page.locator('.ann').count())
    ctx.close()

    # reopen (new browser process, same profile)
    ctx, page = launch(p)
    page.wait_for_selector('.file-item'); page.wait_for_timeout(800)
    print('after reopen active:', page.locator('.file-item.active .fname').inner_text(), '| progress', page.locator('.progress-row').inner_text())
    page.locator('.file-item').nth(0).click(); page.wait_for_selector('.page-canvas'); page.wait_for_timeout(500)
    print('annotations after reopen (file1):', page.locator('.ann').count())

    # exports
    page.click('.export-toggle')
    with page.expect_download() as d: page.click('text=Grades (CSV)')
    d.value.save_as(f'{OUT}/grades.csv')
    with page.expect_download() as d: page.click('text=Current graded PDF')
    d.value.save_as(f'{OUT}/current_graded.pdf')
    with page.expect_download(timeout=60000) as d: page.click('text=All graded PDFs (ZIP)')
    d.value.save_as(f'{OUT}/all.zip')
    page.wait_for_timeout(500)
    page.screenshot(path=f'{OUT}/04_export.png')
    ctx.close()

print('ERRORS:', json.dumps(errors, ensure_ascii=False, indent=1)[:3000])
