import glob, time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    page = br.new_context(timezone_id='Asia/Taipei', accept_downloads=True).new_page()
    page.add_init_script("try{localStorage.setItem('pgw.guideSeen','1')}catch(e){}"); page.goto('file:///home/claude/pdf-grader/dist-portable/index.html'); page.wait_for_selector('.sidebar')
    page.locator('input[type=file][accept*=pdf]').set_input_files(sorted(glob.glob('/home/claude/testpdfs/set50/*.pdf'))[:2])
    page.wait_for_selector('.page-canvas')
    page.keyboard.press('s'); page.keyboard.type('90'); page.keyboard.press('Enter'); page.wait_for_timeout(600)
    print('browser local time now:', page.evaluate("new Date().toString()"))
    page.click('.export-toggle')
    with page.expect_download() as d: page.click('text=Grades (CSV)')
    print(open(d.value.path(), encoding='utf-8-sig').read())
    br.close()
