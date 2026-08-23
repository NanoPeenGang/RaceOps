# -*- coding: utf-8 -*-
from _gen import *

rows = [
    navrow('Overview', 'home', active=True),
    navrow('Roster', 'users', count='24'),
    navrow('Hiring', 'inbox', badge='4'),
    navrow('Money', 'dollar'),
    navrow('Garage', 'wrench'),
    navrow('Racing', 'flag'),
    navrow('Comms', 'message', badge='2'),
    navrow('Settings', 'sliders'),
]
footer = ('<div style="border-top:1px solid var(--line);padding:10px 0 12px">'
          + navlabel('Running now') + navrow('Round 3 &#183; Road Atlanta', 'stopwatch', live=True) + '</div>')

behind = ('<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:18px;padding:22px 28px;overflow:hidden">'
          + crumbs(['Apex Racing', 'Overview'])
          + pageheader('Apex Racing', 'Atlanta, Georgia &#183; endurance &#183; 24 people on the roster',
                       actions=btn('Team page', 'outline') + btn('Invite someone', 'primary', icon='plus'))
          + '<div style="display:flex;gap:12px">'
          + stat('Needs you', '7', 'across hiring, garage and comms', accent=True)
          + stat('Next on track', 'Sat 12 Sep', 'Round 3 &#183; Road Atlanta')
          + stat('Seats to fill', '3', '2 driver, 1 crew chief')
          + '</div></div>')

console = (topbar('Team', 'Apex Racing', 'AR')
           + '<div style="flex:1;display:flex;min-height:0">' + sidebar(rows, footer) + behind + '</div>')

def path(parts):
    out = []
    for i, p in enumerate(parts):
        if i:
            out.append('<span style="color:var(--muted);opacity:.7;margin:0 5px">&#8250;</span>')
        out.append('<span>%s</span>' % p)
    return ('<span style="font-size:11.5px;color:var(--muted)">%s</span>' % ''.join(out))

def res(icon, title, sub, selected=False, kbd=None, iconbg=None):
    bg = 'background:var(--wash);' if selected else ''
    rail = ('<div style="position:absolute;left:0;top:6px;bottom:6px;width:3px;border-radius:0 3px 3px 0;'
            'background:var(--red)"></div>') if selected else ''
    icol = 'var(--on-red)' if iconbg else ('var(--ink)' if selected else 'var(--muted)')
    ibg = iconbg or 'var(--chip)'
    k = ('<span style="font-size:10.5px;font-weight:600;color:var(--muted);border:1px solid var(--line);'
         'border-radius:5px;padding:2px 6px;background:var(--wash);flex-shrink:0">%s</span>' % kbd) if kbd else ''
    return ('<div style="position:relative;display:flex;align-items:center;gap:12px;padding:9px 14px;%s">%s'
            '<span style="width:28px;height:28px;border-radius:7px;background:%s;color:%s;display:flex;'
            'align-items:center;justify-content:center;flex-shrink:0">%s</span>'
            '<div style="flex:1;min-width:0">'
            '<div style="font-size:13.5px;font-weight:%s;color:var(--ink);white-space:nowrap;overflow:hidden;'
            'text-overflow:ellipsis">%s</div>'
            '<div style="margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">%s</div>'
            '</div>%s</div>'
            % (bg, rail, ibg, icol, ico(icon, 15), '600' if selected else '500', title, sub, k))

def grp(text):
    return ('<div style="padding:12px 14px 3px;font-size:9.5px;font-weight:700;letter-spacing:.1em;'
            'color:var(--muted);text-transform:uppercase">%s</div>' % text)

palette = (
    '<div style="position:absolute;left:400px;top:96px;width:640px;border:1px solid var(--line);border-radius:14px;'
    'background:var(--surface);box-shadow:var(--pop);overflow:hidden">'
    '<div style="display:flex;align-items:center;gap:12px;padding:15px 18px;border-bottom:1px solid var(--line)">'
    '<span style="color:var(--muted);display:flex">' + ico('search', 19) + '</span>'
    '<span style="font-size:17px;color:var(--ink);font-weight:500">inv</span>'
    '<span style="display:inline-block;width:1.5px;height:20px;background:var(--red)"></span>'
    '<span style="flex:1"></span>'
    '<span style="font-size:11px;font-weight:600;color:var(--muted);border:1px solid var(--line);'
    'border-radius:5px;padding:2px 7px;background:var(--wash)">esc</span></div>'
    '<div style="padding:2px 0 8px">'
    + grp('Jump to')
    + res('dollar', 'Invoices', path(['Apex Racing', 'Garage', 'Invoices']), selected=True, iconbg='var(--red)')
    + res('dollar', 'Payroll', path(['Apex Racing', 'Money', 'Payroll']))
    + res('box', 'Inventory', path(['Apex Racing', 'Garage', 'Inventory']))
    + grp('Do something')
    + res('plus', 'Create an invoice',
          '<span style="font-size:11.5px;color:var(--muted)">Apex Racing &#8212; bill third-party work</span>')
    + res('check', 'Mark an invoice paid',
          '<span style="font-size:11.5px;color:var(--muted)">Apex Racing &#8212; 2 outstanding</span>')
    + res('scan', 'Scan a part into inventory',
          '<span style="font-size:11.5px;color:var(--muted)">Apex Racing &#8212; opens the scan station</span>')
    + grp('Recently opened')
    + res('doc', 'INV-0046 &#183; Privateer #77',
          '<span style="font-size:11.5px;color:var(--muted)">$6,150.00 &#183; 12 days overdue</span>')
    + '</div>'
    '<div style="border-top:1px solid var(--line);background:var(--wash);padding:9px 16px;display:flex;'
    'align-items:center;gap:18px">'
    '<span style="font-size:11.5px;color:var(--muted)">&#8629; open</span>'
    '<span style="font-size:11.5px;color:var(--muted)">&#8593;&#8595; move</span>'
    '<span style="font-size:11.5px;color:var(--muted)">&#8677; switch context</span>'
    '<span style="flex:1"></span>'
    '<span style="font-size:11.5px;color:var(--muted)">45 pages, one keystroke away</span></div>'
    '</div>'
)

body = ('<div style="position:relative;flex:1;display:flex;flex-direction:column;min-height:0">'
        + console
        + '<div style="position:absolute;inset:0;background:rgba(10,10,10,.42)"></div>'
        + palette + '</div>')

write('CommandPalette.dc.html', doc(body, 1440, 900))
