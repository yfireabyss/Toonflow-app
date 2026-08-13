import shutil, os
p = r'E:\94-Toonflow\data\web\index.html'
bak = r'E:\94-Toonflow\data\web\index.html.bak'
OLD = 'o=ue("http://localhost:10588/api")'
NEW = 'o=ue(window.location.origin+"/api")'
text = open(p, 'r', encoding='utf-8').read()
n = text.count(OLD)
print(f'count_old={n}')
if n == 1:
    if not os.path.exists(bak):
        shutil.copy2(p, bak)
        print(f'BACKUP -> {bak}')
    text2 = text.replace(OLD, NEW, 1)
    open(p, 'w', encoding='utf-8').write(text2)
    print(f'PATCHED ({len(text2)} bytes)')
    n2 = open(p, 'r', encoding='utf-8').read().count(NEW)
    print(f'verify_new_count={n2}')
elif n == 0:
    print('NO_MATCH (already fixed)')
else:
    print(f'MULTI_MATCH count={n} (refuse to patch)')
