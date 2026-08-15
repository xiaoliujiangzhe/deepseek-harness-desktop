import tarfile, os, sys

src = r'C:\Users\XLJZ\Projects\dsh\vendor\deepseek-harness.tar.gz'
dst = r'C:\Users\XLJZ\Projects\dsh\harness-src'
os.makedirs(dst, exist_ok=True)

ok = 0
fail = 0
with tarfile.open(src, 'r:gz') as t:
    members = t.getmembers()
    total = len(members)
    print('total members:', total)
    for i, m in enumerate(members):
        try:
            t.extract(m, dst, filter='data')
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 20:
                print('FAIL', m.name, '->', type(e).__name__, e)
        if (i + 1) % 2000 == 0:
            print(f'progress {i+1}/{total} ok={ok} fail={fail}')
print('DONE ok=', ok, 'fail=', fail)
print('package.json exists:', os.path.exists(os.path.join(dst, 'deepseek-harness-master', 'package.json')))
print('packages exists:', os.path.exists(os.path.join(dst, 'deepseek-harness-master', 'packages')))
