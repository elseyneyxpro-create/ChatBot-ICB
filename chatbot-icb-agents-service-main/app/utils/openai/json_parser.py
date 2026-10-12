import re

# Un par "\\" ya escapado, o un backslash que NO inicia un escape JSON válido.
# \u solo es válido si le siguen 4 dígitos hex (si no, es LaTeX: \underline, \cup...).
_BACKSLASH_RE = re.compile(r'\\\\|\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})')


def pre_escape_latex_backslashes(raw: str) -> str:
    """
    Prepara la salida JSON del LLM antes de json.loads().

    El modelo suele escribir LaTeX sin escapar dentro de strings JSON (ej. "\\alpha" como \alpha),
    lo que hace fallar json.loads() con "Invalid \\escape". Esta función duplica cada backslash
    que no forme un escape JSON válido. Los escapes válidos (\\f, \\t, \\b, \\n...) se dejan tal cual
    y los repara después _fix_latex_escapes() en reinforcer.py.
    """
    if not raw:
        return raw
    return _BACKSLASH_RE.sub(lambda m: m.group(0) if m.group(0) == "\\\\" else "\\\\", raw)
