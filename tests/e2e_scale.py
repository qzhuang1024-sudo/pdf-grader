import sys, os, glob, time, json, shutil
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file:///home/claude/pdf-grader/dist-portable/index.html'
OUT = '/home/claude/testout'; os.makedirs(OUT, exist_ok=True)
PROFILE = '/home/claude/pw-profile2'; shutil.rmtree(PROFILE, ignore_errors=True)
errors = []
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(PROFILE, headless=True, viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    page = ctx.pages[0]
    page.on('console', lambda m: m.type in ('error','warning') and 'MSung' not in m.text and errors.append(f'[{m.type}] {m.text[:300]}'))
    page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
    page.add_init_script("try{localStorage.setItem('pgw.guideSeen','1')}catch(e){}"); page.goto(URL); page.wait_for_selector('.sidebar')

    # ── 50 PDFs via folder picker
    t0 = time.time()
    page.locator('input[type=file][webkitdirectory]').set_input_files('/home/claude/testpdfs/set50')
    page.wait_for_function("document.querySelectorAll('.file-item').length === 50", timeout=60000)
    page.wait_for_selector('.page-canvas')
    print('folder import 50: %.2fs' % (time.time()-t0))

    # grade all 50 by keyboard only: S, type score, Enter
    page.keyboard.press('s')
    times = []
    for i in range(50):
        t = time.time()
        page.keyboard.type(str(60 + (i * 7) % 41))
        page.keyboard.press('Enter')
        if i < 49:
            page.wait_for_function(f"document.querySelector('.file-item.active .fname')?.textContent === 'student{i+2:02d}.pdf'")
            page.wait_for_selector('.page-canvas')
        times.append(time.time()-t)
    print('switch time per student: avg %.3fs max %.3fs' % (sum(times)/len(times), max(times)))
    print('progress:', page.locator('.progress-row').inner_text().replace('\n', ' | '))

    # ── large 300 page PDF + heavy 41MB scanned PDF
    t0 = time.time()
    page.locator('input[type=file][accept*=pdf]').set_input_files(['/home/claude/testpdfs/large_300pages.pdf', '/home/claude/testpdfs/scanned_40pages.pdf', '/home/claude/testpdfs/mixed_rotated.pdf'])
    page.wait_for_function("document.querySelectorAll('.file-item').length === 53", timeout=120000)
    print('import 3 big files: %.2fs' % (time.time()-t0))
    page.locator('.file-item', has_text='large_300pages').click()
    t0 = time.time()
    page.wait_for_function("document.querySelector('.page-input span')?.textContent?.includes('300')", timeout=60000)
    page.wait_for_selector('.page-canvas')
    print('open 300-page: %.2fs' % (time.time()-t0))
    sc = page.locator('.viewer-scroll')
    for frac in [0.25, 0.5, 0.75, 1.0]:
        page.evaluate(f"(() => {{ const el = document.querySelector('.viewer-scroll'); el.scrollTop = el.scrollHeight * {frac}; }})()")
        page.wait_for_timeout(700)
    print('canvases in DOM after scrolling 300 pages:', page.locator('.page-canvas').count(), '| page label', page.locator('.page-input input').input_value())
    page.locator('.page-input input').fill('150'); page.keyboard.press('Enter'); page.wait_for_timeout(800)
    print('jump to page 150 ->', page.locator('.page-input input').input_value())
    # annotate page 150 and verify persistence
    b = page.locator('.page[data-page="150"]').bounding_box()
    page.keyboard.press('r'); page.mouse.move(b['x']+100, b['y']+100); page.mouse.down(); page.mouse.move(b['x']+300, b['y']+200, steps=4); page.mouse.up()
    page.keyboard.press('v')

    page.locator('.file-item', has_text='scanned_40pages').click()
    t0 = time.time()
    page.wait_for_function("document.querySelector('.page-input span')?.textContent?.includes('40')", timeout=60000)
    page.wait_for_selector('.page-canvas')
    print('open 41MB scanned: %.2fs' % (time.time()-t0))
    # UI responsiveness probe while scrolling the heavy doc
    lag = page.evaluate('''async () => {
      const el = document.querySelector('.viewer-scroll'); let worst = 0; let last = performance.now();
      const id = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last - 16); last = n; }, 16);
      for (let i = 0; i < 20; i++) { el.scrollTop += 600; await new Promise(r => setTimeout(r, 100)); }
      clearInterval(id); return Math.round(worst);
    }''')
    print('worst main-thread stall while scrolling scanned PDF: %d ms' % lag)
    page.screenshot(path=f'{OUT}/10_scanned.png')

    # ── rotated / landscape pages + view rotation + text
    page.locator('.file-item', has_text='mixed_rotated').click()
    page.wait_for_function("document.querySelector('.page-input span')?.textContent?.includes('3')")
    page.wait_for_selector('.page[data-page="3"]')
    page.keyboard.press('f'); page.wait_for_timeout(400)
    page.locator('.page-input input').fill('3'); page.keyboard.press('Enter'); page.wait_for_timeout(600)
    b = page.locator('.page[data-page="3"]').bounding_box()
    page.keyboard.press('r'); page.mouse.move(b['x']+40, b['y']+40); page.mouse.down(); page.mouse.move(b['x']+160, b['y']+120, steps=4); page.mouse.up()
    page.keyboard.press('t'); page.mouse.click(b['x']+60, b['y']+180); page.wait_for_selector('.text-editor'); page.keyboard.type('Rotated page note 旋轉頁'); page.keyboard.press('Escape')
    # rotate the view and write upright text
    page.keyboard.press('Shift+R'); page.wait_for_timeout(600)
    page.locator('.page-input input').fill('1'); page.keyboard.press('Enter'); page.wait_for_timeout(500)
    b = page.locator('.page[data-page="1"]').bounding_box()
    page.keyboard.press('t'); page.mouse.click(b['x']+80, b['y']+60); page.wait_for_selector('.text-editor'); page.keyboard.type('Written in rotated view'); page.keyboard.press('Escape')
    page.keyboard.press('a'); page.mouse.move(b['x']+80, b['y']+120); page.mouse.down(); page.mouse.move(b['x']+250, b['y']+200, steps=4); page.mouse.up()
    page.keyboard.press('v')
    page.keyboard.press('s'); page.keyboard.type('75'); page.keyboard.press('Escape')
    page.wait_for_timeout(600)
    page.screenshot(path=f'{OUT}/11_rotated_view.png')
    page.click('.export-toggle')
    with page.expect_download() as d: page.click('text=Current graded PDF')
    d.value.save_as(f'{OUT}/mixed_graded.pdf')
    t0 = time.time()
    with page.expect_download(timeout=180000) as d: page.click('text=All graded PDFs (ZIP)')
    d.value.save_as(f'{OUT}/all53.zip')
    print('ZIP export 53 files: %.2fs' % (time.time()-t0))
    ctx.close()
print('ERRORS:', json.dumps(errors, ensure_ascii=False, indent=1)[:3000])
