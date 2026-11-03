"""Turn dist-demo/index.html (from `npm run build:demo`) into the page fragment the
Artifact preview expects (no doctype/html/head/body; the host adds its own skeleton).
Usage: python3 scripts/make-preview.py <output.html>"""
import re
import sys

src = open("dist-demo/index.html", encoding="utf-8").read()
head = re.search(r"<head>(.*)</head>", src, re.S).group(1)
body = re.search(r"<body>(.*)</body>", src, re.S).group(1)
for pat in (r'<meta charset[^>]*>\s*', r'<meta name="viewport"[^>]*>\s*', r'<link rel="icon"[^>]*>\s*', r"<title>.*?</title>\s*"):
    head = re.sub(pat, "", head, flags=re.S)
page = (
    "<title>AP Desk</title>\n"
    "<style>html,body,#root{height:100%}body{background:#fff;color:#141a24}</style>\n"
    + head.strip() + "\n" + body.strip() + "\n"
)
out = sys.argv[1] if len(sys.argv) > 1 else "preview.html"
open(out, "w", encoding="utf-8").write(page)
print(f"wrote {out} ({len(page) // 1024} KB)")
