# -*- coding: utf-8 -*-
from _gen import *

# --- the console behind the dropdown (dimmed) ---
rows = [
    navrow('Overview', 'home', active=True),
    navrow('Roster', 'users', count='24'),
    navrow('Hiring', 'inbox', badge='4'),
    navrow('Money', 'dollar'),
    navrow('Garage', 'wrench', expanded=False),
    navrow('Racing', 'flag'),
    navrow('Comms', 'message', badge='2'),
    navrow('Settings', 'sliders'),
]
footer = ('<div style="border-top:1px solid var(--line);padding:10px 0 12px">'
          + navlabel('Running now')
          + navrow('Round 3 &#183; Road Atlanta', 'stopwatch', live=True) + '</div>')

behind = (
    '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:18px;padding:22px 28px;overflow:hidden">'
    + crumbs(['Apex Racing', 'Overview'])
    + pageheader('Apex Racing', 'Atlanta, Georgia &#183; endurance &#183; 24 people on the roster',
                 actions=btn('Team page', 'outline') + btn('Invite someone', 'primary', icon='plus'))
    + '<div style="display:flex;gap:12px">'
    + stat('Needs you', '7', 'across hiring, garage and comms', accent=True)
    + stat('Next on track', 'Sat 12 Sep', 'Round 3 &#183; Road Atlanta')
    + stat('Seats to fill', '3', '2 driver, 1 crew chief')
    + '</div>'
    + card('<div style="font-size:15px;font-weight:600;color:var(--ink)">This week</div>'
           '<div style="font-size:13px;color:var(--muted);margin-top:4px">'
           'Four applications waiting, one invoice 12 days overdue, and tech inspection paperwork due Thursday.</div>',
           pad=20, extra='flex:1;')
    + '</div>'
)

console = (topbar('Team', 'Apex Racing', 'AR')
           + '<div style="flex:1;display:flex;min-height:0">' + sidebar(rows, footer) + behind + '</div>')

# --- the dropdown ---
def item(initials, name, sub, active=False, live=False, kind='chip'):
    check = ('<span style="color:var(--red);display:flex;flex-shrink:0">%s</span>' % ico('check', 16)) if active else ''
    ld = ('<span style="flex-shrink:0;margin-right:2px">%s</span>' % dot(7)) if live else ''
    bg = 'background:var(--wash);' if active else ''
    av = avatar(initials, 30, 8, 'var(--red)' if kind == 'red' else 'var(--chip)',
                'var(--on-red)' if kind == 'red' else 'var(--ink)')
    return ('<div style="display:flex;align-items:center;gap:11px;padding:8px 12px;border-radius:8px;%s">'
            '%s<div style="flex:1;min-width:0">'
            '<div style="font-size:13px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;'
            'text-overflow:ellipsis">%s</div>'
            '<div style="font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;'
            'text-overflow:ellipsis;margin-top:1px">%s</div></div>%s%s</div>'
            % (bg, av, name, sub, ld, check))

def group(text):
    return ('<div style="padding:12px 12px 4px;font-size:9.5px;font-weight:700;letter-spacing:.1em;'
            'color:var(--muted);text-transform:uppercase">%s</div>' % text)

dropdown = (
    '<div style="position:absolute;left:58px;top:58px;width:372px;border:1px solid var(--line);border-radius:12px;'
    'background:var(--surface);box-shadow:var(--pop);overflow:hidden">'
    '<div style="padding:10px 12px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:9px">'
    '<span style="color:var(--muted);display:flex">' + ico('search', 16) + '</span>'
    '<span style="flex:1;font-size:13px;color:var(--muted)">Switch context&#8230;</span></div>'
    '<div style="padding:2px 6px 8px">'
    + group('Personal')
    + item('NB', 'You', 'Your seats, messages, passes and applications')
    + group('Teams')
    + item('AR', 'Apex Racing', 'Team manager &#183; 24 people', active=True)
    + item('RB', 'Rust Bucket Racing', 'Crew &#183; 9 people')
    + group('Series and organizations')
    + item('CC', 'ChampCar Endurance Series', 'Series staff &#183; 22 events in 2026')
    + item('24', '24 Hours of Lemons', 'Volunteer &#183; 14 events in 2026')
    + item('AE', 'American Endurance Racing', 'Volunteer &#183; 9 events in 2026')
    + group('Race weekends')
    + item('R3', 'Round 3 &#183; Road Atlanta', 'Race control &#183; running now', live=True, kind='red')
    + item('B8', 'Barber 8 Hour', 'Entered &#183; starts Sat 3 Oct')
    + '</div>'
    '<div style="border-top:1px solid var(--line);padding:10px 14px;display:flex;align-items:center;gap:8px;'
    'background:var(--wash)">'
    '<span style="color:var(--muted);display:flex">' + ico('grid', 15) + '</span>'
    '<span style="font-size:12px;color:var(--muted);flex:1">Looking for something you are not part of?</span>'
    '<span style="font-size:12px;font-weight:600;color:var(--red)">Explore</span></div>'
    '</div>'
)

body = ('<div style="position:relative;flex:1;display:flex;flex-direction:column;min-height:0">'
        + console
        + '<div style="position:absolute;inset:0;background:rgba(10,10,10,.32)"></div>'
        + '<div style="position:absolute;left:0;top:0;width:1440px;height:64px;overflow:hidden">'
        + topbar('Team', 'Apex Racing', 'AR') + '</div>'
        + '<div style="position:absolute;left:44px;top:12px;width:250px;height:40px">'
        + switcher('Team', 'Apex Racing', 'AR', open_=True, width=250) + '</div>'
        + dropdown
        + '</div>')

write('ContextSwitcher.dc.html', doc(body, 1440, 900))
