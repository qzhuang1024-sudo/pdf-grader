import sys
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///home/claude/pdf-grader/dist-portable/index.html'
errors = []
with sync_playwright() as p:
    br = p.chromium.launch(headless=True); page = br.new_page(viewport={'width': 1440, 'height': 900})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL); page.wait_for_selector('.sidebar')
    page.wait_for_selector('.modal.guide', timeout=5000)
    print('auto-opened on first visit:', page.locator('.guide-body h4').inner_text())
    page.screenshot(path='/home/claude/testout/70_guide.png')
    page.click('.guide-nav button:has-text("多人批改")'); print('section:', page.locator('.guide-body h4').inner_text())
    page.keyboard.press('Escape'); page.wait_for_timeout(200); print('closed:', page.locator('.modal.guide').count() == 0)
    page.reload(); page.wait_for_selector('.sidebar'); page.wait_for_timeout(800)
    print('not reopened after reload:', page.locator('.modal.guide').count() == 0)
    page.click('.sb-footer >> text=使用說明'); print('footer button opens:', page.locator('.modal.guide').count() == 1)
    page.click('.guide-nav >> text=快捷鍵一覽'); print('shortcuts from guide:', page.locator('.shortcut-table').count() == 1)
    page.keyboard.press('Escape')
    page.click('.guide-btn'); print('? button opens:', page.locator('.modal.guide').count() == 1); page.keyboard.press('Escape')
    page.click('.viewer-empty-card >> text=使用說明'); print('empty-state button opens:', page.locator('.modal.guide').count() == 1)
    br.close()
print('errors:', errors)
