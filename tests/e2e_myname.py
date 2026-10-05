import glob, sys
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///home/claude/pdf-grader/dist-portable/index.html'
errors = []
with sync_playwright() as p:
    br = p.chromium.launch(headless=True); page = br.new_page(viewport={'width': 1440, 'height': 900})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script("try{localStorage.setItem('pgw.guideSeen','1')}catch(e){}"); page.goto(URL); page.wait_for_selector('.sidebar')
    page.locator('input[type=file][accept*=pdf]').set_input_files(sorted(glob.glob('/home/claude/testpdfs/set50/*.pdf'))[:2])
    page.wait_for_selector('.page-canvas')
    page.select_option('.grader-row-head select', '2'); page.wait_for_selector('.whoami-box')
    print('needs-name highlight:', page.locator('.myname.needs-name').count() == 1, '| placeholder:', page.locator('.myname input').get_attribute('placeholder'))
    page.locator('.myname input').fill('王老師'); page.keyboard.press('Enter'); page.wait_for_timeout(300)
    print('whoami options:', page.locator('.whoami select option').all_inner_texts(), '| chip:', page.locator('.tb-grader').inner_text())
    print('score label:', page.locator('.grader-label').first.inner_text().replace('\n', ' '))
    page.select_option('.whoami select', 'g2'); page.wait_for_timeout(200)
    page.locator('.myname input').fill('王老師'); page.keyboard.press('Enter'); page.wait_for_timeout(300)
    print('duplicate rejected:', page.locator('.toast.error').last.inner_text(), '| options:', page.locator('.whoami select option').all_inner_texts())
    page.locator('.myname input').fill('李助教'); page.keyboard.press('Enter'); page.wait_for_timeout(300)
    print('after rename 2:', page.locator('.whoami select option').all_inner_texts())
    page.reload(); page.wait_for_selector('.whoami-box'); page.wait_for_timeout(500)
    print('after reload: me =', page.locator('.whoami select option:checked').inner_text(), '| myname =', page.locator('.myname input').input_value())
    page.screenshot(path='/home/claude/testout/80_myname.png', clip={'x': 0, 'y': 300, 'width': 345, 'height': 360})
    br.close()
print('errors:', errors)
