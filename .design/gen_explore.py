# -*- coding: utf-8 -*-
from _gen import *

def facet(label, checked=False, count=None):
    box = ('<span style="width:15px;height:15px;border-radius:4px;flex-shrink:0;display:flex;align-items:center;'
           'justify-content:center;background:var(--red);color:var(--on-red)">%s</span>' % ico('check', 11, 2.4)) if checked else \
          '<span style="width:15px;height:15px;border-radius:4px;border:1px solid var(--line2);flex-shrink:0"></span>'
    c = ('<span style="font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums">%s</span>' % count) if count else ''
    return ('<div style="display:flex;align-items:center;gap:9px;padding:5px 0">%s'
            '<span style="flex:1;font-size:12.5px;color:%s;font-weight:%s">%s</span>%s</div>'
            % (box, 'var(--ink)' if checked else 'var(--nav)', '600' if checked else '500', label, c))

def facet_group(title, items):
    return ('<div style="padding:0 20px 16px">'
            '<div style="font-size:9.5px;font-weight:700;letter-spacing:.1em;color:var(--muted);'
            'text-transform:uppercase;padding:14px 0 4px">%s</div>%s</div>' % (title, ''.join(items)))

rail = ('<div style="width:246px;flex-shrink:0;border-right:1px solid var(--line);background:var(--surface);'
        'display:flex;flex-direction:column;overflow:hidden">'
        '<div style="padding:16px 20px 0;display:flex;align-items:center;gap:8px">'
        '<span style="color:var(--ink);display:flex">' + ico('filter', 17) + '</span>'
        '<span style="flex:1;font-size:13px;font-weight:600;color:var(--ink)">Filters</span>'
        '<span style="font-size:11.5px;font-weight:600;color:var(--red)">Clear</span></div>'
        + facet_group('Discipline', [
            facet('Endurance', True, '164'), facet('Sprint', False, '211'),
            facet('Time attack', False, '48'), facet('Rallycross', False, '19'),
            facet('Karting', False, '73'), facet('Sim racing', False, '96')])
        + facet_group('When', [
            facet('This weekend', False, '11'), facet('Next 30 days', True, '38'),
            facet('Rest of the season', False, '90'), facet('Past events', False)])
        + facet_group('Region', [
            facet('Southeast', True, '62'), facet('Texas', False, '34'),
            facet('Northeast', False, '41'), facet('Midwest', False, '55'), facet('West', False, '48')])
        + facet_group('Series', [
            facet('ChampCar Endurance Series', True, '22'),
            facet('24 Hours of Lemons', False, '14'),
            facet('American Endurance Racing', False, '9')])
        + '</div>')

def kindchip(text, color='var(--chip)', fg='var(--ink)'):
    return ('<span style="display:inline-flex;align-items:center;border-radius:4px;padding:2px 7px;font-size:9.5px;'
            'font-weight:800;letter-spacing:.09em;text-transform:uppercase;background:%s;color:%s">%s</span>'
            % (color, fg, text))

def result(kind, kind_color, kind_fg, initials, av_bg, av_fg, title, meta, right_top, right_sub, status=None, skind='outline'):
    st = ('<div style="margin-top:8px;display:flex;justify-content:flex-end">%s</div>' % badge(status, skind)) if status else ''
    return card(
        '<div style="display:flex;align-items:flex-start;gap:14px">'
        + avatar(initials, 42, 9, av_bg, av_fg, 14) +
        '<div style="flex:1;min-width:0">'
        '<div style="display:flex;align-items:center;gap:8px">%s</div>'
        '<div style="font-size:15px;font-weight:600;color:var(--ink);margin-top:6px;letter-spacing:-.01em;'
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">%s</div>'
        '<div style="font-size:12.5px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;'
        'text-overflow:ellipsis">%s</div></div>'
        '<div style="flex-shrink:0;text-align:right">'
        '<div style="font-size:13px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums">%s</div>'
        '<div style="font-size:11.5px;color:var(--muted);margin-top:2px">%s</div>%s</div></div>'
        % (kindchip(kind, kind_color, kind_fg), title, meta, right_top, right_sub, st), pad=16)

RED, ONRED, CHIP, INK = 'var(--red)', 'var(--on-red)', 'var(--chip)', 'var(--ink)'

results = [
    result('Event', RED, ONRED, 'R3', RED, ONRED,
           'Round 3 &#8212; Michelin Raceway Road Atlanta',
           'ChampCar Endurance Series &#183; 14 hours &#183; Braselton, GA',
           '12&#8211;14 Sep', '58 of 65 entries', 'Entries open', 'outline'),
    result('Series', CHIP, INK, '24', CHIP, INK,
           '24 Hours of Lemons',
           '$500 cars, real racing &#183; 14 events in the 2026 season',
           '14 events', 'Next: 26 Sep'),
    result('Event', RED, ONRED, 'B8', CHIP, INK,
           'Barber 8 Hour',
           'American Endurance Racing &#183; 8 hours &#183; Birmingham, AL',
           '03 Oct', '41 of 55 entries', 'Entries open', 'outline'),
    result('Track', CHIP, INK, 'HH', CHIP, INK,
           'Harris Hill Raceway',
           'San Marcos, Texas &#183; Full Course &#183; 1.82 mi &#183; 11 turns',
           '1.82 mi', '11 turns'),
    result('Team', CHIP, INK, 'AR', CHIP, INK,
           'Apex Racing',
           'Atlanta, Georgia &#183; endurance &#183; 24 people &#183; 3 open seats',
           '3 seats', 'Hiring now', 'Recruiting', 'red'),
    result('Track', CHIP, INK, 'G2', CHIP, INK,
           'G2 Motorsports Park',
           'Sherman, Texas &#183; Full Course &#183; 3.10 mi &#183; 22 turns',
           '3.10 mi', '22 turns'),
    result('Series', CHIP, INK, 'CC', CHIP, INK,
           'ChampCar Endurance Series',
           'Wheel-to-wheel endurance on a budget &#183; 22 events in the 2026 season',
           '22 events', 'Next: 12 Sep'),
]

chips = ('<div style="display:flex;align-items:center;gap:8px">'
         + badge('Everything &#183; 447', 'red') + badge('Events &#183; 128', 'outline')
         + badge('Series &#183; 9', 'outline') + badge('Teams &#183; 214', 'outline')
         + badge('Tracks &#183; 96', 'outline')
         + '<span style="flex:1"></span>'
         '<span style="font-size:12px;color:var(--muted)">Sorted by</span>'
         '<span style="font-size:12px;font-weight:600;color:var(--ink)">Soonest first</span>'
         '</div>')

applied = ('<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">'
           '<span style="font-size:11.5px;color:var(--muted)">Showing</span>'
           + badge('Endurance &#215;') + badge('Next 30 days &#215;') + badge('Southeast &#215;')
           + badge('ChampCar Endurance Series &#215;') + '</div>')

content = ('<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:14px;padding:22px 28px;overflow:hidden">'
           + pageheader('Explore',
                        'Events, series, teams and tracks in one place &#8212; four directories were always the same search with the filter nailed down.',
                        actions=btn('Save this search', 'outline'))
           + chips + applied
           + '<div style="flex:1;min-height:0;display:flex;flex-direction:column;gap:10px">'
           + ''.join(results) + '</div></div>')

body = (topbar('Personal', 'You', 'NB', explore_active=True)
        + '<div style="flex:1;display:flex;min-height:0">' + rail + content + '</div>')

write('Explore.dc.html', doc(body, 1440, 940))
