"""Synthetic local DOM tests only. Browser location is injected into the script fixture; no real Facebook navigation/login or extension installation."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
URL='https://business.facebook.com/latest/inbox/all/?asset_id=123&selected_item_id=456&thread_type=FB_MESSAGE'
LINK='https://www.facebook.com/profile.php?id=999'
helper=(ROOT/'tenh-extension/src/profile-sync-helpers.js').read_text()
observer=(ROOT/'tenh-extension/src/profile-sync.js').read_text()
checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1200,'height':900})
    page.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html',body='<!doctype html><body></body>'))
    def inspect(html,url=URL):
        page.goto('about:blank')
        page.set_content('<style>aside,section,div{min-height:25px}a{display:inline-block;width:160px;height:30px}</style>'+html)
        page.evaluate('window.__sent=[];window.chrome={runtime:{id:"fixture",sendMessage:(m,cb)=>{window.__sent.push(m);cb({saved:true});}}}')
        page.add_script_tag(content=helper)
        page.evaluate('(args) => { new Function("location", args.code)({ href: args.url }); }', {'code': observer, 'url': url})
        return page.evaluate('TenhPassiveProfileInspector.inspect()')
    def check(name,html,expected=True,url=URL):
        result=inspect(html,url)
        if expected is True: assert result and result['publicProfileUrl']==LINK,(name,result)
        elif isinstance(expected,str): assert result and result['publicProfileUrl']==expected,(name,result)
        else: assert result is None,(name,result)
        checks.append(name)
    def pane(link=LINK,id='456',label='View profile',attrs=''):
        return f'<aside role="complementary" data-customer-id="{id}" {attrs}><h2>Customer</h2><a href="{link}">{label}</a></aside>'
    check('Explicit visible selected customer link',pane())
    check('Wrong customer pane rejected',pane(id='457'),False)
    check('PSID public URL rejected',pane(LINK.replace('999','456')),False)
    check('Page URL rejected',pane(LINK.replace('999','123')),False)
    check('Own account link rejected',pane('https://www.facebook.com/me'),False)
    check('Hidden pane rejected',pane(attrs='hidden'),False)
    check('Hidden link rejected',pane().replace('<a ','<a style="display:none" '),False)
    check('Global profile menu rejected','<nav>'+pane()+'</nav>',False)
    check('Message authored link not profile identity','<div role="log">'+pane()+'</div>',False)
    check('Arbitrary sender-id div not contact-details','<div data-customer-id="456"><a href="'+LINK+'">View profile</a></div>',False)
    check('Ambiguous links rejected',pane().replace('</aside>','<a href="https://www.facebook.com/anotherCustomer">View profile</a></aside>'),False)
    check('Chat ordinary link label ignored',pane(label='Look at this picture'),False)
    check('Username URL preserved',pane('https://www.facebook.com/customerActual'), 'https://www.facebook.com/customerActual')
    check('Wrapped Facebook URL accepted',pane('https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.facebook.com%2Fprofile.php%3Fid%3D999'))
    check('Same-name heading requires selected exact thread','<a aria-current="page" aria-label="Customer" href="'+URL+'">Customer</a><aside role="complementary"><h2>Customer</h2><a href="'+LINK+'">View profile</a></aside>')
    check('Wrong selected thread cannot use name match','<a aria-current="page" aria-label="Customer" href="'+URL.replace('456','457')+'">Customer</a><aside role="complementary"><h2>Customer</h2><a href="'+LINK+'">View profile</a></aside>',False)
    check('Mismatch heading does not guess customer','<a aria-current="page" aria-label="Another" href="'+URL+'">Another</a><aside role="complementary"><h2>Customer</h2><a href="'+LINK+'">View profile</a></aside>',False)
    check('Khmer profile label',pane(label='មើលប្រវត្តិរូប'))
    check('IG thread not treated as Facebook',pane(),False,URL.replace('FB_MESSAGE','IG_MESSAGE'))
    check('Page without selected customer does not sync',pane(),False,'https://business.facebook.com/latest/inbox/all/?asset_id=123')
    # Exercise the timers and actual messages without a real extension installation.
    inspect(pane());page.wait_for_timeout(2300)
    assert len(page.evaluate('__sent'))==1
    checks.append('Stable selection emits one observation after settle delay')
    for _ in range(5): page.evaluate('document.body.append(document.createElement("div"))')
    page.wait_for_timeout(2000)
    assert len(page.evaluate('__sent'))==1
    checks.append('Repeated DOM changes do not spam identical accepted observations')
    page.evaluate('TenhPassiveProfileInspector.stop();document.body.append(document.createElement("div"))')
    page.wait_for_timeout(1000);assert len(page.evaluate('__sent'))==1
    checks.append('Observer stops on cleanup')
    browser.close()
print(json.dumps({'kind':'synthetic Chromium DOM fixtures (not installed extension or live Facebook)','passed':len(checks),'checks':checks},indent=2))
