# -*- coding: utf-8 -*-
from _gen import *

W, H = 1600, 900
PANEL = 736

def window(inner, height=506):
    return ('<div style="width:%dpx;height:%dpx;border:1px solid var(--line);border-radius:12px;'
            'background:var(--paper);box-shadow:var(--card);overflow:hidden;display:flex;flex-direction:column;'
            'position:relative">%s</div>' % (PANEL, height, inner))

def col_label(kicker, title, tone='muted'):
    kc = 'var(--red)' if tone == 'red' else 'var(--muted)'
    return ('<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px">'
            '<span style="font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;'
            'color:%s">%s</span>'
            '<span style="font-size:16px;font-weight:600;letter-spacing:-.015em;color:var(--ink)">%s</span></div>'
            % (kc, kicker, title))

# ---------------------------------------------------------------- TODAY -----
NAV = ['Home', 'Discover', 'Events', 'Series', 'Teams', 'Tracks', 'Opportunities', 'Reports', 'Pit Wall']
ACCOUNT = ['My passes', 'Messages', 'My organizations', 'My applications', 'Apply to publish',
           'Sponsor console', 'My postings', 'Notifications', 'Billing', 'My profile']
TEAM_TABS = ['Roster', 'Hiring', 'Money', 'Garage', 'Racing', 'Comms', 'Settings']
GARAGE_PANELS = [('Cars and setups', '4 cars'), ('Inventory', '212 stock lines'),
                 ('Telemetry and setup files', '38 files'), ('Services and maintenance', '9 open'),
                 ('Invoices', '5 lines')]

nav_html = ''.join(
    '<span style="font-size:11px;font-weight:500;color:var(--nav);white-space:nowrap">%s</span>' % n for n in NAV)

today_header = ('<div style="height:46px;flex-shrink:0;border-bottom:1px solid var(--line);background:var(--paper);'
                'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 12px">'
                '<div style="display:flex;align-items:center;gap:18px;min-width:0">' + mark(26) +
                '<div style="display:flex;align-items:center;gap:13px;min-width:0">%s</div></div>'
                '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'
                '<div style="display:flex;align-items:center;gap:4px;border:1px solid var(--red);border-radius:6px;'
                'padding:3px 7px"><span style="font-size:11px;font-weight:600;color:var(--ink)">Account</span>'
                '<span style="color:var(--muted);display:flex">%s</span></div>'
                '<span style="color:var(--nav);display:flex">%s</span>' + avatar('NB', 22, 9999) + '</div></div>'
                ) % (nav_html, ico('chevdown', 13), ico('bell', 15))

acct_menu = ('<div style="position:absolute;right:12px;top:50px;width:196px;border:1px solid var(--line);'
             'border-radius:10px;background:var(--surface);box-shadow:var(--pop);padding:5px;z-index:3">'
             + ''.join('<div style="padding:6px 9px;font-size:11.5px;color:var(--nav);border-radius:6px">%s</div>' % a
                       for a in ACCOUNT)
             + '<div style="border-top:1px solid var(--line);margin:4px 0"></div>'
             '<div style="padding:6px 9px;font-size:11.5px;color:var(--nav)">Access applications</div></div>')

tabbar = ('<div style="position:relative">'
          '<div style="display:flex;gap:4px;border-bottom:1px solid var(--line);overflow:hidden">'
          + ''.join('<div style="padding:7px 11px;border-bottom:2px solid %s;font-size:11.5px;font-weight:500;'
                    'color:%s;white-space:nowrap">%s</div>'
                    % ('var(--red)' if t == 'Garage' else 'transparent',
                       'var(--ink)' if t == 'Garage' else 'var(--muted)', t) for t in TEAM_TABS)
          + '</div></div>')

def panel_row(name, meta, open_=False):
    return ('<div style="border:1px solid var(--line);border-radius:9px;background:var(--surface);padding:10px 13px;'
            'display:flex;align-items:center;gap:9px">'
            '<span style="color:var(--muted);display:flex">%s</span>'
            '<span style="flex:1;font-size:12px;font-weight:600;color:var(--ink)">%s</span>'
            '<span style="font-size:11px;color:var(--muted)">%s</span></div>'
            % (ico('chevdown' if open_ else 'chevright', 14), name, meta))

today_body = ('<div style="flex:1;min-height:0;padding:14px 16px;display:flex;flex-direction:column;gap:11px">'
              '<div style="font-size:11px;color:var(--muted)">Teams / Apex Racing / Manage</div>'
              '<div style="font-size:20px;font-weight:700;letter-spacing:-.025em;color:var(--ink)">Apex Racing</div>'
              + tabbar
              + '<div style="display:flex;flex-direction:column;gap:7px">'
              + ''.join(panel_row(n, m, open_=(n == 'Invoices')) for n, m in GARAGE_PANELS)
              + '</div>'
              '<div style="border:1px dashed var(--line2);border-radius:9px;padding:11px 13px;background:var(--wash)">'
              '<div style="font-size:11.5px;color:var(--muted);line-height:1.5">'
              'Mark paid and Delete live inside this panel &#8212; behind the toggle, past the fold. '
              'Shipped weeks ago; reported as missing.</div></div>'
              '</div>')

today_win = window(today_header + acct_menu + today_body)

# ------------------------------------------------------------- PROPOSED -----
prop_header = ('<div style="height:46px;flex-shrink:0;border-bottom:1px solid var(--line);background:var(--paper);'
               'display:flex;align-items:center;gap:12px;padding:0 12px">'
               + mark(26)
               + '<div style="height:30px;padding:0 8px 0 6px;border-radius:7px;border:1px solid var(--line);'
                 'background:var(--surface);display:flex;align-items:center;gap:7px">'
               + avatar('AR', 20, 6)
               + '<div style="display:flex;flex-direction:column;gap:0px">'
                 '<div style="font-size:8px;font-weight:700;letter-spacing:.09em;color:var(--muted);'
                 'text-transform:uppercase">Team</div>'
                 '<div style="font-size:11.5px;font-weight:600;color:var(--ink)">Apex Racing</div></div>'
               + '<span style="color:var(--muted);display:flex">' + ico('chevdown', 13) + '</span></div>'
               '<div style="flex:1;display:flex;justify-content:center">'
               '<div style="width:250px;height:28px;border-radius:7px;border:1px solid var(--line);'
               'background:var(--surface);display:flex;align-items:center;gap:7px;padding:0 8px">'
               '<span style="color:var(--muted);display:flex">' + ico('search', 13) + '</span>'
               '<span style="flex:1;font-size:11px;color:var(--muted)">Search or jump to&#8230;</span>'
               '<span style="font-size:9.5px;font-weight:600;color:var(--muted);border:1px solid var(--line);'
               'border-radius:4px;padding:1px 4px">&#8984;K</span></div></div>'
               '<div style="display:flex;align-items:center;gap:10px;flex-shrink:0">'
               '<span style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:500;color:var(--nav)">'
               + ico('grid', 14) + '<span>Explore</span></span>'
               '<span style="color:var(--nav);display:flex">' + ico('bell', 15) + '</span>'
               + avatar('NB', 22, 9999) + '</div></div>')

def mini_nav(label, icon=None, active=False, indent=False, badge_=None, expanded=None, live=False):
    pad = 30 if indent else 13
    color = 'var(--ink)' if active else 'var(--nav)'
    weight = '600' if active else '500'
    bg = 'background:var(--wash);' if active else ''
    rail = ('<div style="position:absolute;left:0;top:4px;bottom:4px;width:2.5px;border-radius:0 3px 3px 0;'
            'background:var(--red)"></div>') if active else ''
    ic = ('<span style="display:flex;color:%s;flex-shrink:0">%s</span>' % (color, ico(icon, 14))) if icon else ''
    right = ''
    if badge_:
        right = ('<span style="background:var(--red);color:var(--on-red);font-size:8.5px;font-weight:700;'
                 'border-radius:9999px;min-width:14px;height:14px;display:flex;align-items:center;'
                 'justify-content:center;padding:0 4px">%s</span>' % badge_)
    elif live:
        right = dot(6)
    elif expanded is not None:
        right = ('<span style="color:var(--muted);display:flex">%s</span>'
                 % ico('chevdown' if expanded else 'chevright', 12))
    return ('<div style="position:relative;height:26px;padding-left:%dpx;padding-right:9px;display:flex;'
            'align-items:center;gap:8px;%s">%s%s'
            '<span style="flex:1;font-size:11px;font-weight:%s;color:%s;white-space:nowrap;overflow:hidden;'
            'text-overflow:ellipsis">%s</span>%s</div>'
            % (pad, bg, rail, ic, weight, color, label, right))

prop_side = ('<div style="width:186px;flex-shrink:0;border-right:1px solid var(--line);background:var(--surface);'
             'padding-top:8px;display:flex;flex-direction:column">'
             '<div style="flex:1;display:flex;flex-direction:column;gap:1px">'
             + mini_nav('Overview', 'home') + mini_nav('Roster', 'users')
             + mini_nav('Hiring', 'inbox', badge_='4') + mini_nav('Money', 'dollar')
             + mini_nav('Garage', 'wrench', expanded=True)
             + mini_nav('Inventory', indent=True) + mini_nav('Parts &amp; labels', indent=True)
             + mini_nav('Telemetry &amp; setups', indent=True) + mini_nav('Services', indent=True)
             + mini_nav('Invoices', indent=True, active=True, badge_='1')
             + mini_nav('Racing', 'flag') + mini_nav('Comms', 'message', badge_='2')
             + mini_nav('Settings', 'sliders') + '</div>'
             '<div style="border-top:1px solid var(--line);padding:7px 0 9px">'
             '<div style="padding:4px 13px 3px;font-size:8px;font-weight:700;letter-spacing:.1em;color:var(--muted);'
             'text-transform:uppercase">Running now</div>'
             + mini_nav('Round 3 &#183; Road Atlanta', 'stopwatch', live=True) + '</div></div>')

def mini_inv(num, client, amount, status, kind, action, last=False):
    border = '' if last else 'border-bottom:1px solid var(--line);'
    return ('<div style="display:flex;align-items:center;gap:9px;padding:8px 12px;%s">'
            '<span style="width:64px;flex-shrink:0;font-size:11px;font-weight:600;color:var(--ink);'
            'font-variant-numeric:tabular-nums">%s</span>'
            '<span style="flex:1;min-width:0;font-size:11px;color:var(--ink);white-space:nowrap;overflow:hidden;'
            'text-overflow:ellipsis">%s</span>'
            '<span style="width:64px;flex-shrink:0;text-align:right;font-size:11px;font-weight:600;color:var(--ink);'
            'font-variant-numeric:tabular-nums">%s</span>'
            '<span style="flex-shrink:0">%s</span>'
            '<span style="width:74px;flex-shrink:0;display:flex;justify-content:flex-end">%s</span></div>'
            % (border, num, client, amount, badge(status, kind), action))

mini_btn = ('<span style="height:22px;padding:0 8px;border-radius:5px;border:1px solid var(--line2);'
            'display:inline-flex;align-items:center;font-size:10px;font-weight:500;color:var(--ink)">Mark paid</span>')
mini_btn_solid = ('<span style="height:22px;padding:0 8px;border-radius:5px;background:var(--ink);color:var(--on-ink);'
                  'display:inline-flex;align-items:center;font-size:10px;font-weight:500">Mark paid</span>')

prop_body = ('<div style="flex:1;min-width:0;padding:13px 16px;display:flex;flex-direction:column;gap:10px;'
             'overflow:hidden">'
             '<div style="font-size:10.5px;color:var(--muted)">Apex Racing / Garage / Invoices</div>'
             '<div style="display:flex;align-items:center;gap:8px">'
             '<div style="flex:1;font-size:19px;font-weight:700;letter-spacing:-.025em;color:var(--ink)">Invoices</div>'
             '<span style="height:24px;padding:0 9px;border-radius:5px;background:var(--red);color:var(--on-red);'
             'display:inline-flex;align-items:center;font-size:10.5px;font-weight:500">New invoice</span></div>'
             + card_raw(
                 mini_inv('INV-0047', 'Harris Hill Raceway', '$4,280', 'Issued', 'outline', mini_btn)
                 + mini_inv('INV-0046', 'Privateer #77 &#8212; engine refresh', '$6,150', 'Overdue', 'red', mini_btn_solid)
                 + mini_inv('INV-0045', 'G2 Motorsports Park', '$1,940', 'Paid', 'default', '')
                 + mini_inv('INV-0044', 'Rust Bucket Racing', '$2,050', 'Paid', 'default', '', last=True))
             + '<div style="border:1px dashed var(--line2);border-radius:9px;padding:11px 13px;background:var(--wash)">'
             '<div style="font-size:11.5px;color:var(--muted);line-height:1.5">'
             'Same features, same code. One page, its own address, every action on the row.</div></div>'
             '</div>')

prop_win = window(prop_header + '<div style="flex:1;display:flex;min-height:0">' + prop_side + prop_body + '</div>')

# -------------------------------------------------------------- findings ----
def finding(n, title, body_text, tone='muted'):
    c = 'var(--red)' if tone == 'red' else 'var(--muted)'
    return ('<div style="display:flex;gap:11px;align-items:flex-start">'
            '<span style="width:20px;height:20px;border-radius:9999px;border:1px solid %s;color:%s;flex-shrink:0;'
            'display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;'
            'font-variant-numeric:tabular-nums">%s</span>'
            '<div style="min-width:0"><div style="font-size:12.5px;font-weight:600;color:var(--ink)">%s</div>'
            '<div style="font-size:12px;color:var(--muted);line-height:1.5;margin-top:2px">%s</div></div></div>'
            % (c, c, n, title, body_text))

today_findings = ('<div style="display:flex;flex-direction:column;gap:11px;margin-top:16px">'
                  + finding('1', '20 top-level destinations',
                            'Nine in the bar, ten in the account menu, one for staff. Half are only reachable after a click.', 'red')
                  + finding('2', 'The thing you are operating is not in the navigation',
                            'A team, a championship, a race weekend &#8212; each rebuilds its own tab strip inside the page instead.', 'red')
                  + finding('3', 'Seven tabs, then five stacked panels',
                            'Invoices is a toggle inside a panel inside a tab. That is three clicks below the surface.', 'red')
                  + '</div>')

prop_findings = ('<div style="display:flex;flex-direction:column;gap:11px;margin-top:16px">'
                 + finding('1', 'The switcher names what you are operating',
                           'You, a team, a championship, a race weekend. Everything below the bar belongs to that one thing.')
                 + finding('2', 'The console is a rail, not a strip',
                           'Eight entries visible at once instead of seven that scroll, and each one has a real address.')
                 + finding('3', 'Explore and &#8984;K carry the rest',
                           'Four directories collapse into one faceted search; 45 pages become one keystroke and a name.')
                 + '</div>')

# ------------------------------------------------------------------ head ----
head = ('<div style="padding:30px 40px 0">'
        '<div style="font-size:10px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;'
        'color:var(--red)">RaceOps &#183; structural redesign</div>'
        '<h1 style="margin:9px 0 0;font-size:30px;font-weight:700;letter-spacing:-.03em;color:var(--ink)">'
        'The app is organised around nouns. People work inside a context.</h1>'
        '<p style="margin:8px 0 0;max-width:1000px;font-size:14px;color:var(--muted);line-height:1.55">'
        'Both screens below are the same feature, the same data and the same components. Only the structure above '
        'them changes.</p></div>')

cols = ('<div style="flex:1;min-height:0;display:flex;gap:44px;padding:26px 40px 30px">'
        '<div style="width:%dpx;flex-shrink:0">%s%s%s</div>'
        '<div style="width:%dpx;flex-shrink:0">%s%s%s</div>'
        '</div>'
        % (PANEL, col_label('Today', 'Noun-first', 'red'), today_win, today_findings,
           PANEL, col_label('Proposed', 'Context-first'), prop_win, prop_findings))

write('TodayVsProposed.dc.html', doc(head + cols, W, H))
