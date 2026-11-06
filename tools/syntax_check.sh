#!/usr/bin/env bash
# JS 语法检查（无 Node 环境，使用 macOS 内置 JavaScriptCore）
# 用法: bash tools/syntax_check.sh [目录]
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
fail=0
while IFS= read -r f; do
  out=$(osascript -l JavaScript - "$f" <<'JXA'
ObjC.import('Foundation');
function run(argv) {
  var path = argv[0];
  var err = $();
  var s = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, err);
  if (s.isNil()) return 'READ_FAIL';
  var src = ObjC.unwrap(s);
  try { new Function(src); return 'OK'; }
  catch (e) { return 'SYNTAX_ERROR: ' + e.message; }
}
JXA
)
  if [ "$out" = "OK" ]; then
    echo "OK      $f"
  else
    echo "FAIL    $f -> $out"
    fail=1
  fi
done < <(find "$ROOT/src" "$ROOT/tests" -name "*.js" -not -path "*/mock-site/*" 2>/dev/null | sort)
exit $fail
