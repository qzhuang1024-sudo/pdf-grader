import glob, sys, json
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///home/claude/pdf-grader/dist-portable/index.html'
OUT = '/home/claude/testout'; errors = []
with sync_playwright() as p:
    br = p.chromium.launch(headless=True); page = br.new_page(viewport={'width': 1366, 'height': 768}, accept_downloads=True)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL); page.wait_for_selector('.sidebar')
    page.locator('input[type=file][multiple]').set_input_files(sorted(glob.glob('/home/claude/testpdfs/set50/*.pdf'))[:1])
    page.wait_for_selector('.page-canvas'); page.wait_for_timeout(400)
    b = page.locator('.page[data-page="1"]').bounding_box()
    page.keyboard.press('t')
    print('toggle on by default:', page.locator('.tb-toggle.on').count())
    # 1) drag → fixed-width box, long mixed text wraps
    page.mouse.move(b['x']+520, b['y']+260); page.mouse.down(); page.mouse.move(b['x']+760, b['y']+300, steps=5); page.mouse.up()
    page.wait_for_selector('.text-editor.boxed.fixed-width')
    page.keyboard.type('單位錯誤：逕流係數應無因次，請重新檢查第二題的計算過程 (check units and significant figures)')
    page.keyboard.press('Escape'); page.wait_for_timeout(200)
    lines = page.locator('.page[data-page="1"] text').first.locator('tspan').count()
    print('wrapped lines:', lines)
    # 2) click → auto-width box
    page.mouse.click(b['x']+520, b['y']+460); page.wait_for_selector('.text-editor.boxed'); page.keyboard.type('Good! 很好'); page.keyboard.press('Escape')
    # 3) toggle off → plain text
    page.click('.tb-toggle'); page.mouse.click(b['x']+520, b['y']+540); page.wait_for_selector('.text-editor'); page.keyboard.type('plain text, no box'); page.keyboard.press('Escape')
    page.click('.tb-toggle')  # back on
    page.wait_for_timeout(200)
    # 4) select first box, drag its resize handle wider
    page.keyboard.press('v')
    t = page.locator('.page[data-page="1"] text').first.bounding_box()
    page.mouse.click(t['x']+10, t['y']+5)
    h = page.locator('.resize-handle').bounding_box()
    page.mouse.move(h['x']+h['width']/2, h['y']+h['height']/2); page.mouse.down(); page.mouse.move(h['x']+120, h['y']+h['height']/2, steps=6); page.mouse.up()
    page.wait_for_timeout(200)
    print('lines after widening:', page.locator('.page[data-page="1"] text').first.locator('tspan').count())
    page.keyboard.press('Control+z'); page.wait_for_timeout(100)
    print('lines after undo:', page.locator('.page[data-page="1"] text').first.locator('tspan').count())
    page.keyboard.press('Control+Shift+z')
    page.mouse.click(b['x']+30, b['y']+30)
    page.wait_for_timeout(600)
    page.screenshot(path=f'{OUT}/40_textbox.png')
    page.click('.export-toggle')
    with page.expect_download() as d: page.click('text=Current graded PDF')
    d.value.save_as(f'{OUT}/textbox_graded.pdf')
    br.close()
print('errors:', errors)
