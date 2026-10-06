import os

dir_path = r'C:\Users\Chetana\.gemini\antigravity-ide\scratch\moneymagic-dashboard'
with open(os.path.join(dir_path, 'index.html'), 'r', encoding='utf-8') as f:
    html = f.read()

with open(os.path.join(dir_path, 'style.css'), 'r', encoding='utf-8') as f:
    css = f.read()

with open(os.path.join(dir_path, 'app.js'), 'r', encoding='utf-8') as f:
    js = f.read()

html = html.replace('<link rel="stylesheet" href="style.css">', f'<style>\n{css}\n</style>')
html = html.replace('<script src="app.js"></script>', f'<script>\n{js}\n</script>')

out_path = os.path.join(dir_path, 'the-meter-moneymagic.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(html)

print("Generated bundle size:", len(html))
