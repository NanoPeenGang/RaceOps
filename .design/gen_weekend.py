# -*- coding: utf-8 -*-
from _gen import *

rows = [
    navrow('Race weekend', 'calendar'),
    navrow('Entries', 'ticket', count='58'),
    navrow('Paddock &amp; tech', 'box'),
    navrow('Race control', 'flag', expanded=True),
    navrow('Live timing', None, indent=True, live=True),
    navrow('Incidents', None, indent=True, active=True, badge='3'),
    navrow('Penalties', None, indent=True),
    navrow('Bulletins', None, indent=True),
    navrow('Gate check-in', None, indent=True),
    navrow('Broadcast', None, indent=True),
    navrow('Results', 'stopwatch'),
    navrow('Volunteers', 'users', count='12'),
    navrow('Documents &amp; notices', 'doc'),
    navrow('Settings', 'sliders'),
]

footer = ('<div style="border-top:1px solid var(--line);padding:10px 0 12px">'
          + navlabel('Also yours')
          + navrow('Apex Racing', 'wrench', badge='4')
          + navrow('ChampCar Endurance Series', 'flag')
          + '</div>')

live_strip = ('<div style="border-radius:10px;background:var(--red);color:var(--on-red);padding:11px 16px;'
              'display:flex;align-items:center;gap:14px">'
              '<span style="display:inline-flex;align-items:center;gap:7px;font-size:10px;font-weight:800;'
              'letter-spacing:.11em;text-transform:uppercase">%s Live</span>'
              '<span style="width:1px;height:16px;background:currentColor;opacity:.35"></span>'
              '<span style="font-size:13px;font-weight:600">Race &#8212; 7h 48m remaining</span>'
              '<span style="width:1px;height:16px;background:currentColor;opacity:.35"></span>'
              '<span style="font-size:13px">Green flag &#183; 58 cars running</span>'
              '<span style="flex:1"></span>'
              '<span style="font-size:12px;font-weight:600;opacity:.9;font-variant-numeric:tabular-nums">14:22:41 local</span>'
              '</div>' % dot(8, 'var(--on-red)'))

def inc_row(cars, where, when, source, status, kind, last=False):
    border = '' if last else 'border-bottom:1px solid var(--line);'
    return ('<div style="display:flex;align-items:center;gap:14px;padding:12px 18px;%s">'
            '<div style="width:104px;flex-shrink:0;font-size:13px;font-weight:600;color:var(--ink)">%s</div>'
            '<div style="width:66px;flex-shrink:0;font-size:12px;color:var(--muted)">%s</div>'
            '<div style="width:74px;flex-shrink:0;font-size:12px;color:var(--muted);'
            'font-variant-numeric:tabular-nums">%s</div>'
            '<div style="flex:1;min-width:0;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;'
            'text-overflow:ellipsis">%s</div>'
            '<div style="flex-shrink:0">%s</div></div>'
            % (border, cars, where, when, source, badge(status, kind)))

inc_head = ('<div style="display:flex;align-items:center;gap:14px;padding:9px 18px;border-bottom:1px solid var(--line);background:var(--wash)">'
            '<div style="width:104px;flex-shrink:0;font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--muted);text-transform:uppercase">Cars</div>'
            '<div style="width:66px;flex-shrink:0;font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--muted);text-transform:uppercase">Where</div>'
            '<div style="width:74px;flex-shrink:0;font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--muted);text-transform:uppercase">Time</div>'
            '<div style="flex:1;font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--muted);text-transform:uppercase">Reported by</div>'
            '<div style="flex-shrink:0;width:96px"></div></div>')

incidents = card_raw(inc_head + ''.join([
    inc_row('#114 v #303', 'Turn 10a', '14:22:08', 'Marshal post 9', 'Under review', 'red'),
    inc_row('#77', 'Turn 5', '13:58:41', 'Race control', 'Noted', 'outline'),
    inc_row('#212 v #48', 'Turn 1', '13:12:55', 'Apex Racing', 'Penalty issued', 'default'),
    inc_row('#9', 'Pit lane', '12:41:19', 'Pit marshal', 'Closed', 'default'),
    inc_row('#303', 'Turn 12', '11:55:02', 'Marshal post 12', 'Closed', 'default', last=True),
]))

def side_line(label, value, last=False):
    border = '' if last else 'border-bottom:1px solid var(--line);'
    return ('<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;%s">'
            '<span style="font-size:12px;color:var(--muted)">%s</span>'
            '<span style="font-size:13px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums">%s</span></div>'
            % (border, label, value))

session_card = card(
    '<div style="font-size:13px;font-weight:600;color:var(--ink)">Session</div>'
    '<div style="margin-top:8px">'
    + side_line('Elapsed', '6h 12m')
    + side_line('Remaining', '7h 48m')
    + side_line('Flag', 'Green')
    + side_line('Cars running', '58 of 61')
    + side_line('Leader', '#114 &#183; lap 191', last=True)
    + '</div>', pad=16)

quick = card(
    '<div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:12px">Race control</div>'
    '<div style="display:flex;flex-direction:column;gap:8px">'
    + btn('Throw a full-course caution', 'primary', size='md')
    + btn('Log an incident', 'outline', size='md')
    + btn('Publish a bulletin', 'outline', size='md')
    + '</div>', pad=16)

content = (
    '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;padding:22px 28px;overflow:hidden">'
    + crumbs(['ChampCar Endurance Series', 'Round 3 &#183; Road Atlanta', 'Race control', 'Incidents'])
    + live_strip
    + pageheader('Incidents',
                 'Everything reported this weekend, newest first. Three still need a steward.',
                 actions=btn('Print the log', 'outline') + btn('Log an incident', 'primary', icon='plus'))
    + '<div style="flex:1;min-height:0;display:flex;gap:16px">'
    + '<div style="flex:1;min-width:0">' + incidents + '</div>'
    + '<div style="width:262px;flex-shrink:0;display:flex;flex-direction:column;gap:14px">'
    + session_card + quick + '</div>'
    + '</div></div>'
)

body = (topbar('Race weekend', 'Round 3 &#183; Road Atlanta', 'R3', live=True)
        + '<div style="flex:1;display:flex;min-height:0">'
        + sidebar(rows, footer)
        + content
        + '</div>')

write('RaceWeekend.dc.html', doc(body, 1440, 900))
