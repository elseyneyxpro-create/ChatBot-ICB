"""
Cliente PostgreSQL (reemplaza a supabase_client.py).
Usa un pool de conexiones de psycopg 3. Las filas se devuelven como dicts,
igual que `result.data` de supabase-py, para que el resto del código cambie poco.
"""
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.core.config import settings

pool = ConnectionPool(
    conninfo=settings.DATABASE_URL,
    min_size=1,
    max_size=10,
    kwargs={"row_factory": dict_row},
    open=True,
)


def fetch_all(sql: str, params: tuple | dict | None = None) -> list[dict]:
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())


def execute(sql: str, params: tuple | dict | None = None) -> None:
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()


def to_pgvector(vec: list[float]) -> str:
    """Convierte una lista de floats al literal de texto que entiende pgvector: '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{x:.8f}" for x in vec) + "]"
