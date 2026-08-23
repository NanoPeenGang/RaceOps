# -*- coding: utf-8 -*-
from _gen import *

rows = [
    navrow('Overview', 'home'),
    navrow('Roster', 'users', count='24'),
    navrow('Hiring', 'inbox', badge='4'),
    navrow('Money', 'dollar'),
    navrow('Garage', 'wrench', expanded=True),
    navrow('Inventory', None, indent=True),
    navrow('Parts &amp; labels', None, indent=True),
    navrow('Telemetry &amp; setups', None, indent=True),
    navrow('Services', None, indent=True),
    navrow('Invoices', None, indent=True, active=True, badge='1'),
    navrow('Racing', 'flag'),
    navrow('Comms', 'message', badge='2'),
    navrow('Settings', 'sliders'),
]

footer = (
    '<div style="border-top:1px solid var(--line);padding:10px 0 12px">'
    + navlabel('Running now')
    + navrow('Round 3 &#183; Road Atlanta', 'stopwatch', live=True)
    + '</div>'
)

def inv_row(num, client, issued, due, amount, status, status_kind, actions, last=False):
    border = '' if last else 'border-bottom:1px solid var(--line);'
    return ('<div style="display:flex;align-items:center;gap:16px;padding:13px 20px;%s">'
            '<div style="width:88px;flex-shrink:0;font-size:13px;font-weight:600;color:var(--ink);'
            'font-variant-numeric:tabular-nums">%s</div>'
            '<div style="flex:1;min-width:0;font-size:13px;color:var(--ink);white-space:nowrap;overflow:hidden;'
            'text-overflow:ellipsis">%s</div>'
            '<div style="width:86px;flex-shrink:0;font-size:12px;color:var(--muted);'
            'font-variant-numeric:tabular-nums">%s</div>'
            '<div style="width:86px;flex-shrink:0;font-size:12px;color:var(--muted);'
            'font-variant-numeric:tabular-nums">%s</div>'
            '<div style="width:92px;flex-shrink:0;text-align:right;font-size:13px;font-weight:600;color:var(--ink);'
            'font-variant-numeric:tabular-nums">%s</div>'
            '<div style="width:84px;flex-shrink:0;display:flex;justify-content:flex-end">%s</div>'
            '<div style="width:132px;flex-shrink:0;display:flex;justify-content:flex-end;gap:6px">%s</div>'
            '</div>' % (border, num, client, issued, due, amount, badge(status, status_kind), actions))

kebab = ('<div style="width:28px;height:28px;border-radius:6px;border:1px solid var(--line2);display:flex;'
         'align-items:center;justify-content:center;color:var(--muted);font-size:14px;font-weight:700;'
         'letter-spacing:.06em;line-height:1">&#183;&#183;&#183;</div>')

head = ('<div style="display:flex;align-items:center;gap:16px;padding:10px 20px;border-bottom:1px solid var(--line);'
        'background:var(--wash)">'
        '<div style="width:88px;flex-shrink:0;font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--muted);text-transform:uppercase">Number</div>'
        '<div style="flex:1;font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--muted);text-transform:uppercase">Billed to</div>'
        '<div style="width:86px;flex-shrink:0;font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--muted);text-transform:uppercase">Issued</div>'
        '<div style="width:86px;flex-shrink:0;font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--muted);text-transform:uppercase">Due</div>'
        '<div style="width:92px;flex-shrink:0;text-align:right;font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--muted);text-transform:uppercase">Amount</div>'
        '<div style="width:84px;flex-shrink:0"></div>'
        '<div style="width:132px;flex-shrink:0"></div>'
        '</div>')

table = card_raw(head + ''.join([
    inv_row('INV-0047', 'Harris Hill Raceway &#8212; corner-worker radio rebuild', '12 Aug 2026', '11 Sep 2026', '$4,280.00', 'Issued', 'outline',
            btn('Mark paid', 'outline') + kebab),
    inv_row('INV-0046', 'Privateer #77 &#8212; engine refresh and dyno', '04 Aug 2026', '03 Sep 2026', '$6,150.00', 'Overdue', 'red',
            btn('Mark paid', 'default') + kebab),
    inv_row('INV-0045', 'G2 Motorsports Park &#8212; timing loop install', '28 Jul 2026', '27 Aug 2026', '$1,940.00', 'Paid', 'default', kebab),
    inv_row('INV-0044', 'Rust Bucket Racing &#8212; cage weld and certification', '21 Jul 2026', '20 Aug 2026', '$2,050.00', 'Paid', 'default', kebab),
    inv_row('&#8212;', 'Barber Motorsports Park &#8212; trailer fabrication', '&#8212;', '&#8212;', '$890.00', 'Draft', 'muted',
            btn('Issue', 'outline') + kebab, last=True),
]), extra='flex:1;min-height:0;')

content = (
    '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:18px;padding:22px 28px;overflow:hidden">'
    + crumbs(['Apex Racing', 'Garage', 'Invoices'])
    + pageheader('Invoices',
                 'Third-party work contracted through the team. Every action on a row, in the open.',
                 actions=btn('Export', 'outline') + btn('New invoice', 'primary', icon='plus'))
    + '<div style="display:flex;gap:12px">'
    + stat('Outstanding', '$10,430.00', '2 invoices awaiting payment')
    + stat('Overdue', '$6,150.00', '1 invoice, 12 days past due', accent=True)
    + stat('Paid this month', '$3,990.00', '2 invoices settled')
    + '</div>'
    + table
    + '</div>'
)

body = (topbar('Team', 'Apex Racing', 'AR')
        + '<div style="flex:1;display:flex;min-height:0">'
        + sidebar(rows, footer)
        + content
        + '</div>')

write('Main.dc.html', doc(body, 1440, 900))
