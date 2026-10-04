"""Independent stdlib AST/import-path oracle for the pinned Typer corpus."""
import ast
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT / 'eval/truth/repos/python/typer'
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip()
assert commit.startswith('a80f6e5ecd'), commit
tracked = subprocess.check_output(['git', 'ls-files', '*.py'], cwd=REPO, text=True).splitlines()
files = {name for name in tracked if (REPO / name).is_file()}
edges = {name: set() for name in files}
syntax_errors = []

def resolve(parts, directory):
    candidate = '/'.join([*directory, *parts])
    for name in (candidate + '.py', candidate + '/__init__.py'):
        if name in files:
            return name
    return None

def search(parts, source, level=0):
    if not level and parts and parts[0] in sys.stdlib_module_names:
        return None
    directory = source.split('/')[:-1]
    if level:
        if level > len(directory) + 1:
            return None
        return resolve(parts, directory[:len(directory) - level + 1])
    # Script-directory lookup followed by enclosing directories and repo root.
    for length in range(len(directory), -1, -1):
        found = resolve(parts, directory[:length])
        if found:
            return found
    return None

for file in sorted(files):
    try:
        tree = ast.parse((REPO / file).read_text(encoding='utf-8-sig'), filename=file)
    except (SyntaxError, UnicodeError) as error:
        syntax_errors.append({'file': file, 'error': str(error)})
        continue
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for name in node.names:
                target = search(name.name.split('.'), file)
                if target:
                    edges[file].add(target)
        elif isinstance(node, ast.ImportFrom):
            module = node.module.split('.') if node.module else []
            base = search(module, file, node.level)
            for name in node.names:
                target = search([*module, name.name], file, node.level) or base
                if target:
                    edges[file].add(target)

reverse = {name: set() for name in files}
for source, targets in edges.items():
    for target in targets:
        reverse[target].add(source)

def reachable(target):
    seen = {target}
    queue = [target]
    while queue:
        for source in reverse[queue.pop()]:
            if source not in seen:
                seen.add(source)
                queue.append(source)
    return seen - {target}

samples = ['typer/_typing.py', 'typer/core.py', 'typer/main.py', 'typer/rich_utils.py']
results = []
for target in samples:
    if target not in files:
        continue
    command = ['node', str(ROOT / 'cli.js'), 'impact', '--cwd', str(REPO), '--file', target,
               '--max-depth', '80', '--max-files', '10000', '--json', '--quiet']
    process = subprocess.run(command, cwd=ROOT, text=True, encoding='utf-8', capture_output=True, timeout=120)
    data = json.loads(process.stdout.lstrip('\ufeff'))
    if process.returncode != 0 or not data.get('ok'):
        raise RuntimeError(process.stderr + process.stdout)
    actual = {Path(item['file']).relative_to(REPO).as_posix() for item in data['impact']}
    expected = reachable(target)
    results.append({'file': target, 'expected': len(expected), 'actual': len(actual),
                    'tp': len(expected & actual), 'fp': sorted(actual - expected),
                    'fn': sorted(expected - actual), 'correct': expected == actual})

report = {'commit': commit, 'pythonFiles': len(files), 'localEdges': sum(map(len, edges.values())),
          'syntaxErrors': syntax_errors, 'samples': results,
          'scope': 'Static Python imports from stdlib AST; dynamic imports and sys.path mutation are outside this oracle.'}
map_process = subprocess.run(
    ['node', str(ROOT / 'cli.js'), 'audit-map', '--cwd', str(REPO),
     '--no-compact', '--max-files', '10000', '--json', '--quiet'],
    cwd=ROOT, text=True, encoding='utf-8', capture_output=True, timeout=120)
map_data = json.loads(map_process.stdout.lstrip('\ufeff'))
if map_process.returncode != 0 or not map_data.get('ok'):
    raise RuntimeError(map_process.stderr + map_process.stdout)
expected_edges = {(source, target) for source, targets in edges.items() for target in targets}
actual_edges = {(edge['from'].replace('\\', '/'), edge['to'].replace('\\', '/'))
                for edge in map_data['edges']}
report['directEdgeComparison'] = {
    'expected': len(expected_edges), 'actual': len(actual_edges),
    'missing': sorted(expected_edges - actual_edges),
    'additional': sorted(actual_edges - expected_edges),
    'status': 'unadjudicated: check package initialization and implicit subprocess edges'}
confirmed_multi = []
for source, target in sorted(expected_edges - actual_edges):
    tree = ast.parse((REPO / source).read_text(encoding='utf-8-sig'))
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom) or len(node.names) < 2:
            continue
        module_parts = node.module.split('.') if node.module else []
        for position, alias in enumerate(node.names):
            if position > 0 and search([*module_parts, alias.name], source, node.level) == target:
                confirmed_multi.append({'source': source, 'target': target, 'line': node.lineno,
                                        'module': '.' * node.level + (node.module or ''),
                                        'names': [name.name for name in node.names]})
                break
report['directEdgeComparison']['multipleSubmoduleEvidence'] = confirmed_multi
all_missing_explained = ({(item['source'], item['target']) for item in confirmed_multi}
                         == expected_edges - actual_edges)
report['directEdgeComparison']['allMissingExplained'] = all_missing_explained
report['directEdgeComparison']['status'] = (
    'Each missing direct edge has explicit multiple-submodule import evidence; '
    'impact differences still require separate adjudication.' if all_missing_explained
    else 'Remaining direct and impact differences require adjudication.')
out = ROOT / 'eval/truth/python-graph-truth.json'
out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'pythonFiles': report['pythonFiles'], 'localEdges': report['localEdges'],
                  'syntaxErrors': len(syntax_errors), 'samples': results}, ensure_ascii=True))
