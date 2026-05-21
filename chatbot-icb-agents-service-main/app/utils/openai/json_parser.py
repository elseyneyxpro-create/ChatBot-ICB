import json


def pre_escape_latex_backslashes(s: str) -> str:
    """
    Repara secuencias de escape invalidas en JSON (comandos LaTeX).
    Procesa caracter a caracter: si ve backslash seguido de char invalido
    en JSON (como 'l', 'g', 'm'...) dobla el backslash.
    Si ve backslash seguido de char valido JSON (n, t, b, f, r, u, ", \, /)
    copia los dos sin cambio.
    """
    VALID = {'"', '/', 'b', 'f', 'n', 'r', 't', 'u'}
    BS = chr(92)
    VALID.add(BS)
    result = []
    i = 0
    while i < len(s):
        c = s[i]
        if c == BS and i + 1 < len(s):
            next_c = s[i + 1]
            if next_c in VALID:
                result.append(c)
                result.append(next_c)
                i += 2
            else:
                result.append(BS)
                result.append(BS)
                i += 1
        else:
            result.append(c)
            i += 1
    return ''.join(result)


def parse_json_response(content: str) -> dict | list:
    """
    Parsea respuesta de OpenAI con o sin bloque ```json.
    Util cuando no se usa response_format=json_object.
    """
    content = content.strip()
    if content.startswith("```"):
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
        content = content.strip()
    content = pre_escape_latex_backslashes(content)
    return json.loads(content)
