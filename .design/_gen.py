# -*- coding: utf-8 -*-
import io, os

FONT = 'ui-sans-serif, system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, sans-serif'
FONTQ = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

TOKENS = """
    body { margin: 0; }
    a { color: var(--red); text-decoration: none; }
    a:hover { color: var(--ink); }
    .rt {
      --ink: #0a0a0a; --paper: #fafafa; --surface: #ffffff; --red: #d91e1e;
      --on-ink: #fafafa; --on-red: #ffffff;
      --line: rgba(10,10,10,.10); --line2: rgba(10,10,10,.20);
      --muted: rgba(10,10,10,.60); --nav: rgba(10,10,10,.70);
      --wash: rgba(10,10,10,.05); --chip: rgba(10,10,10,.10);
      --card: 0 1px 2px 0 rgba(0,0,0,.05);
      --pop: 0 10px 30px -8px rgba(0,0,0,.28), 0 2px 6px -2px rgba(0,0,0,.12);
      font-family: %s;
      -webkit-font-smoothing: antialiased;
    }
    .rt.dark {
      --ink: #ececee; --paper: #121316; --surface: #1b1d21; --red: #ff5f57;
      --on-ink: #121316; --on-red: #2a0b09;
      --line: rgba(236,236,238,.10); --line2: rgba(236,236,238,.20);
      --muted: rgba(236,236,238,.60); --nav: rgba(236,236,238,.70);
      --wash: rgba(236,236,238,.05); --chip: rgba(236,236,238,.10);
      --pop: 0 10px 30px -8px rgba(0,0,0,.6), 0 2px 6px -2px rgba(0,0,0,.4);
    }
""" % FONTQ

ICONS = {
 'home': '<path d="M3 10.2 12 3.2l9 7v9.1a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H4.5A1.5 1.5 0 0 1 3 19.3z"/>',
 'users': '<path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.2"/><path d="M20 20v-1.4a3.5 3.5 0 0 0-2.6-3.4"/><path d="M15.4 4.9a3.2 3.2 0 0 1 0 6.1"/>',
 'inbox': '<path d="M5.6 4.5h12.8l2.1 8.6v4.4a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17.5v-4.4z"/><path d="M3.5 13.1h4.2l1.2 2.2h6.2l1.2-2.2h4.2"/>',
 'dollar': '<path d="M12 3.2v17.6"/><path d="M16.3 7.3a3.5 3.5 0 0 0-3.3-2h-1.7a3.05 3.05 0 0 0 0 6.1h1.4a3.05 3.05 0 0 1 0 6.1h-1.8a3.5 3.5 0 0 1-3.3-2.2"/>',
 'wrench': '<path d="M15.6 3.6a4.6 4.6 0 0 0-5.3 6.2l-6.4 6.4a2.05 2.05 0 0 0 2.9 2.9l6.4-6.4a4.6 4.6 0 0 0 6.2-5.3l-2.9 2.9-3-.8-.8-3z"/>',
 'flag': '<path d="M5.5 21V3.6"/><path d="M5.5 4.5c4-1.6 7 1.6 11 0v8.7c-4 1.6-7-1.6-11 0z"/>',
 'message': '<path d="M20.5 11.8c0 3.9-3.8 7-8.5 7-1 0-2-.1-2.9-.4L4 20.2l1.4-4.1a6.7 6.7 0 0 1-1.9-4.3c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7z"/>',
 'sliders': '<path d="M4 7.2h8.6"/><path d="M17.4 7.2H20"/><circle cx="15" cy="7.2" r="2.4"/><path d="M4 16.8h2.6"/><path d="M11.4 16.8H20"/><circle cx="9" cy="16.8" r="2.4"/>',
 'chevdown': '<path d="m6.5 9.75 5.5 5.5 5.5-5.5"/>',
 'chevright': '<path d="m9.75 6.5 5.5 5.5-5.5 5.5"/>',
 'search': '<circle cx="10.6" cy="10.6" r="6.6"/><path d="m20 20-4.7-4.7"/>',
 'bell': '<path d="M18 8.9a6 6 0 1 0-12 0c0 5.9-2.2 7.6-2.2 7.6h16.4S18 14.8 18 8.9z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
 'plus': '<path d="M12 5v14M5 12h14"/>',
 'calendar': '<rect x="3.5" y="5.2" width="17" height="15.3" rx="2"/><path d="M3.5 10.2h17M8 3v4.2M16 3v4.2"/>',
 'doc': '<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5"/>',
 'grid': '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
 'scan': '<path d="M3.5 8.2V5.6a2.1 2.1 0 0 1 2.1-2.1h2.6M15.8 3.5h2.6a2.1 2.1 0 0 1 2.1 2.1v2.6M20.5 15.8v2.6a2.1 2.1 0 0 1-2.1 2.1h-2.6M8.2 20.5H5.6a2.1 2.1 0 0 1-2.1-2.1v-2.6"/><path d="M3.5 12h17"/>',
 'box': '<path d="M20.5 8.4v7.2L12 20.1 3.5 15.6V8.4L12 3.9z"/><path d="m3.5 8.4 8.5 4.5 8.5-4.5M12 12.9v7.2"/>',
 'megaphone': '<path d="M4 10.1v3.8a1.5 1.5 0 0 0 1.5 1.5H8l6.2 4V4.6L8 8.6H5.5A1.5 1.5 0 0 0 4 10.1z"/><path d="M17.6 9a4.6 4.6 0 0 1 0 6"/>',
 'arrow': '<path d="M4.5 12h15M13.6 6l6 6-6 6"/>',
 'filter': '<path d="M3.6 5.4h16.8l-6.6 7.6v5.4l-3.6 1.8v-7.2z"/>',
 'check': '<path d="m5 12.4 4.6 4.6L19 7.2"/>',
 'clock': '<circle cx="12" cy="12" r="8.6"/><path d="M12 7v5.3l3.4 2"/>',
 'shield': '<path d="M12 3.4 5 6v5.6c0 4.2 2.9 7.4 7 9 4.1-1.6 7-4.8 7-9V6z"/>',
 'ticket': '<path d="M3.5 8.4a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v1.4a2.2 2.2 0 0 0 0 4.4v1.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-1.4a2.2 2.2 0 0 0 0-4.4z"/><path d="M14.2 6.4v11.2"/>',
 'stopwatch': '<circle cx="12" cy="13.4" r="7.2"/><path d="M12 9.6v3.8l2.6 1.6M9.4 3.4h5.2M12 3.4v3"/>',
}

def ico(name, size=20, sw=1.6):
    return ('<svg width="%d" height="%d" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="%s" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">%s</svg>'
            % (size, size, sw, ICONS[name]))

def dot(size=8, color='var(--red)'):
    return '<span style="display:inline-block;width:%dpx;height:%dpx;border-radius:9999px;background:%s"></span>' % (size, size, color)

# --- shared chrome ---------------------------------------------------------

def mark(size=36):
    return ('<div style="width:%dpx;height:%dpx;border-radius:8px;background:var(--red);color:var(--on-red);'
            'display:flex;align-items:center;justify-content:center;font-size:%dpx;font-weight:800;'
            'letter-spacing:-.02em;flex-shrink:0">R</div>' % (size, size, int(size*0.5)))

def avatar(initials, size=24, radius=6, bg='var(--chip)', fg='var(--ink)', fs=None):
    return ('<div style="width:%dpx;height:%dpx;border-radius:%dpx;background:%s;color:%s;display:flex;'
            'align-items:center;justify-content:center;font-size:%dpx;font-weight:700;letter-spacing:-.01em;'
            'flex-shrink:0">%s</div>' % (size, size, radius, bg, fg, fs or max(9, int(size*0.42)), initials))

def switcher(kind, name, initials, open_=False, width=None, live=False):
    w = ('width:%dpx;' % width) if width else ''
    chev = ('<span style="color:var(--muted);transform:rotate(180deg);display:flex">%s</span>' % ico('chevdown', 16)) if open_ \
        else ('<span style="color:var(--muted);display:flex">%s</span>' % ico('chevdown', 16))
    ring = 'box-shadow:0 0 0 2px var(--red);' if open_ else ''
    livedot = ('<span style="margin-left:2px">%s</span>' % dot(7)) if live else ''
    return ('<div style="%sheight:40px;padding:0 10px 0 8px;border-radius:8px;border:1px solid var(--line);'
            'background:var(--surface);display:flex;align-items:center;gap:9px;%s">'
            '%s'
            '<div style="display:flex;flex-direction:column;gap:1px;min-width:0">'
            '<div style="font-size:9px;font-weight:700;letter-spacing:.09em;color:var(--muted);text-transform:uppercase">%s</div>'
            '<div style="font-size:13px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">%s</div>'
            '</div>%s%s</div>'
            % (w, ring, avatar(initials, 26, 7), kind, name, livedot, chev))

def commandbar(text='Search or jump to&#8230;', width=420):
    return ('<div style="width:%dpx;height:36px;border-radius:8px;border:1px solid var(--line);'
            'background:var(--surface);display:flex;align-items:center;gap:9px;padding:0 10px 0 11px">'
            '<span style="color:var(--muted);display:flex">%s</span>'
            '<span style="flex:1;font-size:13px;color:var(--muted)">%s</span>'
            '<span style="font-size:11px;font-weight:600;color:var(--muted);border:1px solid var(--line);'
            'border-radius:5px;padding:2px 6px;background:var(--wash)">&#8984;K</span></div>'
            % (width, ico('search', 16), text))

def topbar(kind, name, initials, live=False, explore_active=False):
    ex_color = 'var(--ink)' if explore_active else 'var(--nav)'
    ex_weight = '600' if explore_active else '500'
    return ('<div style="height:64px;flex-shrink:0;border-bottom:1px solid var(--line);background:var(--paper);'
            'display:flex;align-items:center;gap:16px;padding:0 16px">'
            '<div style="display:flex;align-items:center;gap:12px">%s%s</div>'
            '<div style="flex:1;display:flex;justify-content:center">%s</div>'
            '<div style="display:flex;align-items:center;gap:14px">'
            '<div style="display:flex;align-items:center;gap:7px;font-size:13px;font-weight:%s;color:%s">%s<span>Explore</span></div>'
            '<div style="position:relative;color:var(--nav);display:flex">%s'
            '<span style="position:absolute;top:-1px;right:-1px;width:7px;height:7px;border-radius:9999px;'
            'background:var(--red);border:1.5px solid var(--paper)"></span></div>'
            '%s</div></div>'
            % (mark(34), switcher(kind, name, initials, live=live), commandbar(),
               ex_weight, ex_color, ico('grid', 17), ico('bell', 19), avatar('NB', 30, 9999)))

# --- sidebar ---------------------------------------------------------------

def navrow(label, icon=None, active=False, badge=None, count=None, indent=False,
           expanded=None, live=False, muted_label=False):
    pad_l = 44 if indent else 20
    color = 'var(--ink)' if active else 'var(--nav)'
    weight = '600' if active else '500'
    bg = 'background:var(--wash);' if active else ''
    rail = ('<div style="position:absolute;left:0;top:7px;bottom:7px;width:3px;border-radius:0 3px 3px 0;'
            'background:var(--red)"></div>') if active else ''
    ic = ('<span style="display:flex;color:%s;flex-shrink:0">%s</span>' % (color, ico(icon, 18))) if icon else ''
    right = ''
    if badge is not None:
        right = ('<span style="background:var(--red);color:var(--on-red);font-size:10px;font-weight:700;'
                 'border-radius:9999px;min-width:17px;height:17px;display:flex;align-items:center;'
                 'justify-content:center;padding:0 5px;font-variant-numeric:tabular-nums">%s</span>' % badge)
    elif count is not None:
        right = ('<span style="font-size:11px;font-weight:600;color:var(--muted);'
                 'font-variant-numeric:tabular-nums">%s</span>' % count)
    elif live:
        right = dot(7)
    if expanded is not None:
        right = ('<span style="color:var(--muted);display:flex;transform:rotate(%s)">%s</span>'
                 % ('0deg' if expanded else '0deg', ico('chevdown' if expanded else 'chevright', 15)))
    return ('<div style="position:relative;height:34px;padding-left:%dpx;padding-right:14px;display:flex;'
            'align-items:center;gap:10px;%s">%s%s'
            '<span style="flex:1;font-size:13px;font-weight:%s;color:%s;white-space:nowrap;overflow:hidden;'
            'text-overflow:ellipsis">%s</span>%s</div>'
            % (pad_l, bg, rail, ic, weight, color, label, right))

def navlabel(text):
    return ('<div style="padding:14px 20px 6px;font-size:9.5px;font-weight:700;letter-spacing:.1em;'
            'color:var(--muted);text-transform:uppercase">%s</div>' % text)

def sidebar(rows, footer=None, width=248):
    foot = footer or ''
    return ('<div style="width:%dpx;flex-shrink:0;border-right:1px solid var(--line);background:var(--surface);'
            'display:flex;flex-direction:column;padding-top:10px">'
            '<div style="flex:1;display:flex;flex-direction:column;gap:1px">%s</div>%s</div>'
            % (width, ''.join(rows), foot))

# --- page furniture (matches src/components/ui/page.tsx) --------------------

def crumbs(parts):
    out = []
    for i, p in enumerate(parts):
        if i:
            out.append('<span style="color:var(--muted)">/</span>')
        c = 'var(--muted)' if i < len(parts) - 1 else 'var(--muted)'
        out.append('<span style="color:%s">%s</span>' % (c, p))
    return ('<div style="display:flex;align-items:center;gap:5px;font-size:13px;color:var(--muted)">%s</div>'
            % ''.join(out))

def btn(label, kind='default', icon=None, size='sm'):
    h, px, fs = (32, 12, 12) if size == 'sm' else (40, 16, 14)
    styles = {
        'default': 'background:var(--ink);color:var(--on-ink);border:1px solid transparent;',
        'primary': 'background:var(--red);color:var(--on-red);border:1px solid transparent;',
        'outline': 'background:transparent;color:var(--ink);border:1px solid var(--line2);',
        'ghost': 'background:transparent;color:var(--ink);border:1px solid transparent;',
    }[kind]
    ic = ('<span style="display:flex">%s</span>' % ico(icon, 14)) if icon else ''
    return ('<div style="height:%dpx;padding:0 %dpx;border-radius:6px;display:inline-flex;align-items:center;'
            'justify-content:center;gap:6px;font-size:%dpx;font-weight:500;white-space:nowrap;%s">%s%s</div>'
            % (h, px, fs, styles, ic, label))

def badge(text, kind='default'):
    styles = {
        'default': 'background:var(--chip);color:var(--ink);border:1px solid transparent;',
        'red': 'background:var(--red);color:var(--on-red);border:1px solid transparent;',
        'outline': 'background:transparent;color:var(--ink);border:1px solid var(--line2);',
        'muted': 'background:transparent;color:var(--muted);border:1px dashed var(--line2);',
    }[kind]
    return ('<span style="display:inline-flex;align-items:center;border-radius:9999px;padding:2px 10px;'
            'font-size:11px;font-weight:600;white-space:nowrap;%s">%s</span>' % (styles, text))

def card(inner, pad=20, extra=''):
    return ('<div style="border:1px solid var(--line);border-radius:12px;background:var(--surface);'
            'box-shadow:var(--card);%s"><div style="padding:%dpx">%s</div></div>' % (extra, pad, inner))

def card_raw(inner, extra=''):
    return ('<div style="border:1px solid var(--line);border-radius:12px;background:var(--surface);'
            'box-shadow:var(--card);overflow:hidden;%s">%s</div>' % (extra, inner))

def stat(label, value, sub=None, accent=False):
    subhtml = ('<div style="font-size:11px;color:var(--muted);margin-top:2px">%s</div>' % sub) if sub else ''
    vcol = 'var(--red)' if accent else 'var(--ink)'
    return card(
        '<div style="font-size:10px;font-weight:700;letter-spacing:.09em;color:var(--muted);'
        'text-transform:uppercase">%s</div>'
        '<div style="font-size:24px;font-weight:700;letter-spacing:-.025em;color:%s;margin-top:6px;'
        'font-variant-numeric:tabular-nums">%s</div>%s' % (label, vcol, value, subhtml),
        pad=16, extra='flex:1;min-width:0;')

def pageheader(title, desc=None, actions=None, status=None):
    st = (' %s' % status) if status else ''
    d = ('<div style="font-size:13px;color:var(--muted);margin-top:4px">%s</div>' % desc) if desc else ''
    a = ('<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">%s</div>' % actions) if actions else ''
    return ('<div style="border-bottom:1px solid var(--line);padding-bottom:18px">'
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">'
            '<div style="min-width:0"><div style="display:flex;align-items:center;gap:8px">'
            '<h1 style="margin:0;font-size:28px;font-weight:700;letter-spacing:-.025em;color:var(--ink)">%s</h1>%s</div>%s</div>%s</div></div>'
            % (title, st, d, a))

# --- document wrapper ------------------------------------------------------

def doc(body, w, h, props_extra='', has_theme=True, scroll=False):
    props = '{"theme":{"editor":"enum","options":["Light","Dark"],"default":"Light"},"$preview":{"width":%d,"height":%d}}' % (w, h)
    logic = ("class Component extends DCLogic {\n"
             "  renderVals() {\n"
             "    return { rootClass: this.props.theme === 'Dark' ? 'rt dark' : 'rt' };\n"
             "  }\n"
             "}")
    return ("""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>%s  </style>
</helmet>
<div class="{{rootClass}}" style="width:%dpx;height:%dpx;background:var(--paper);color:var(--ink);display:flex;flex-direction:column;overflow:hidden;font-size:14px;line-height:1.45">
%s
</div>
</x-dc>
<script data-dc-script data-props='%s'>
%s
</script>
</body>
</html>
""" % (TOKENS, w, h, body, props, logic))

def write(name, content):
    with io.open(name, 'w', encoding='utf-8') as f:
        f.write(content)
    print('wrote %s (%d bytes)' % (name, len(content)))
