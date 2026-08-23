# -*- coding: utf-8 -*-
from _gen import *

W, H = 390, 844

top = ('<div style="height:56px;flex-shrink:0;border-bottom:1px solid var(--line);background:var(--paper);'
       'display:flex;align-items:center;gap:10px;padding:0 12px">'
       + mark(30) +
       '<div style="flex:1;min-width:0;display:flex;align-items:center;gap:7px">'
       '<div style="min-width:0">'
       '<div style="font-size:9px;font-weight:700;letter-spacing:.09em;color:var(--muted);text-transform:uppercase">'
       'Race weekend</div>'
       '<div style="font-size:14px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;'
       'text-overflow:ellipsis">Round 3 &#183; Road Atlanta</div></div>'
       + dot(7) +
       '<span style="color:var(--muted);display:flex;flex-shrink:0">' + ico('chevdown', 16) + '</span></div>'
       '<div style="position:relative;color:var(--nav);display:flex;flex-shrink:0;width:44px;height:44px;'
       'align-items:center;justify-content:center">' + ico('bell', 21) +
       '<span style="position:absolute;top:8px;right:9px;width:8px;height:8px;border-radius:9999px;'
       'background:var(--red);border:1.5px solid var(--paper)"></span></div></div>')

live = ('<div style="border-radius:12px;background:var(--red);color:var(--on-red);padding:14px 16px">'
        '<div style="display:flex;align-items:center;gap:8px">'
        + dot(8, 'var(--on-red)') +
        '<span style="font-size:10px;font-weight:800;letter-spacing:.11em;text-transform:uppercase">Race &#183; green</span>'
        '<span style="flex:1"></span>'
        '<span style="font-size:11px;font-weight:600;opacity:.9;font-variant-numeric:tabular-nums">14:22:41</span></div>'
        '<div style="font-size:26px;font-weight:700;letter-spacing:-.03em;margin-top:8px;'
        'font-variant-numeric:tabular-nums">7h 48m left</div>'
        '<div style="font-size:12.5px;opacity:.92;margin-top:3px">#114 leads on lap 191 &#183; 58 of 61 running</div>'
        '</div>')

def tile(icon, label, sub, primary=False):
    bg = 'var(--red)' if primary else 'var(--surface)'
    fg = 'var(--on-red)' if primary else 'var(--ink)'
    sub_c = 'rgba(255,255,255,.85)' if primary else 'var(--muted)'
    border = 'transparent' if primary else 'var(--line)'
    chipbg = 'rgba(255,255,255,.18)' if primary else 'var(--chip)'
    return ('<div style="flex:1;min-width:0;height:108px;border-radius:12px;background:%s;color:%s;'
            'border:1px solid %s;box-shadow:var(--card);padding:14px;display:flex;flex-direction:column;'
            'justify-content:space-between">'
            '<span style="width:34px;height:34px;border-radius:9px;background:%s;display:flex;align-items:center;'
            'justify-content:center">%s</span>'
            '<div><div style="font-size:15px;font-weight:600;letter-spacing:-.01em">%s</div>'
            '<div style="font-size:11.5px;color:%s;margin-top:2px">%s</div></div></div>'
            % (bg, fg, border, chipbg, ico(icon, 19), label, sub_c, sub))

tiles = ('<div style="display:flex;flex-direction:column;gap:12px">'
         '<div style="display:flex;gap:12px">'
         + tile('scan', 'Scan a part', 'In or out of the truck', primary=True)
         + tile('flag', 'Log incident', 'Car, turn, time') + '</div>'
         '<div style="display:flex;gap:12px">'
         + tile('stopwatch', 'Pit stop', 'Next: #114 in 22 min')
         + tile('ticket', 'Gate check-in', '3 crew still outside') + '</div></div>')

def scan_row(part, where, when, dirn, last=False):
    border = '' if last else 'border-bottom:1px solid var(--line);'
    arrow_bg = 'var(--chip)'
    sign = '&#8722;' if dirn == 'out' else '+'
    color = 'var(--red)' if dirn == 'out' else 'var(--ink)'
    return ('<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;%s">'
            '<span style="width:30px;height:30px;border-radius:8px;background:%s;color:var(--muted);display:flex;'
            'align-items:center;justify-content:center;flex-shrink:0">%s</span>'
            '<div style="flex:1;min-width:0">'
            '<div style="font-size:13.5px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;'
            'text-overflow:ellipsis">%s</div>'
            '<div style="font-size:11.5px;color:var(--muted);margin-top:1px">%s</div></div>'
            '<div style="text-align:right;flex-shrink:0">'
            '<div style="font-size:13px;font-weight:700;color:%s;font-variant-numeric:tabular-nums">%s1</div>'
            '<div style="font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums">%s</div></div></div>'
            % (border, arrow_bg, ico('box', 16), part, where, color, sign, when))

recent = card_raw(
    '<div style="padding:13px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px">'
    '<span style="flex:1;font-size:13px;font-weight:600;color:var(--ink)">Last scanned</span>'
    '<span style="font-size:11.5px;font-weight:600;color:var(--red)">All activity</span></div>'
    + scan_row('Front left rotor &#183; PT-0412', 'Out to pit box 14', '14:19', 'out')
    + scan_row('Brake pad set &#183; PT-0388', 'Out to pit box 14', '14:11', 'out')
    + scan_row('Alternator &#183; PT-0201', 'Back into the truck', '13:44', 'in', last=True),
    extra='flex:1;min-height:0;')

def tab(icon, label, active=False):
    c = 'var(--red)' if active else 'var(--muted)'
    w = '600' if active else '500'
    return ('<div style="flex:1;min-width:0;height:56px;display:flex;flex-direction:column;align-items:center;'
            'justify-content:center;gap:3px;color:%s">%s'
            '<span style="font-size:10.5px;font-weight:%s">%s</span></div>' % (c, ico(icon, 21), w, label))

scan_button = ('<div style="flex:1;min-width:0;display:flex;align-items:flex-start;justify-content:center">'
               '<div style="width:58px;height:58px;border-radius:9999px;background:var(--red);color:var(--on-red);'
               'display:flex;align-items:center;justify-content:center;margin-top:-18px;'
               'box-shadow:0 6px 18px -4px rgba(217,30,30,.55)">%s</div></div>' % ico('scan', 25, 1.9))

bottom = ('<div style="height:76px;flex-shrink:0;border-top:1px solid var(--line);background:var(--surface);'
          'display:flex;align-items:flex-start;padding:0 4px">'
          + tab('home', 'Now', active=True) + tab('ticket', 'Entries')
          + scan_button
          + tab('flag', 'Incidents') + tab('grid', 'More') + '</div>')

body = (top
        + '<div style="flex:1;min-height:0;display:flex;flex-direction:column;gap:14px;padding:14px 12px;overflow:hidden">'
        + live + tiles + recent + '</div>'
        + bottom)

write('Trackside.dc.html', doc(body, W, H))
