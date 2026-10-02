import glob, shutil, sys
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///home/claude/pdf-grader/dist-portable/index.html'
errors = []
with sync_playwright() as p:
    br = p.chromium.launch(headless=True); page = br.new_page(viewport={'width': 1366, 'height': 768})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: (print('dialog:', d.message.replace('\n', ' | ')), d.accept()))
    page.goto(URL); page.wait_for_selector('.sidebar')
    u = lambda: page.locator('.storage-usage').inner_text().replace('\n', ' ')
    print('empty:', u(), '| clear disabled:', page.locator('text=清除所有資料').is_disabled())
    page.locator('input[type=file][multiple]').set_input_files(sorted(glob.glob('/home/claude/testpdfs/set50/*.pdf'))[:3] + ['/home/claude/testpdfs/scanned_40pages.pdf'])
    page.wait_for_function("document.querySelectorAll('.file-item').length === 4"); page.wait_for_timeout(500)
    print('after import:', u())
    page.locator('.file-item', has_text='scanned').hover(); page.locator('.file-item', has_text='scanned').locator('.remove-btn').click()
    page.wait_for_function("document.querySelectorAll('.file-item').length === 3"); page.wait_for_timeout(500)
    print('after removing scanned:', u())
    page.click('text=清除所有資料')
    page.wait_for_load_state('load'); page.wait_for_selector('.sidebar'); page.wait_for_timeout(800)
    print('after clear all:', u(), '| files:', page.locator('.file-item').count(), '| assignment:', page.locator('.assignment-name').inner_text())
    page.screenshot(path='/home/claude/testout/30_storage.png', clip={'x': 0, 'y': 600, 'width': 345, 'height': 168})
    br.close()
print('errors:', errors)
