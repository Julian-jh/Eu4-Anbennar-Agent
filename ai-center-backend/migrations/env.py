import os

from alembic import context
from sqlalchemy import create_engine, pool

from sources.models import Base


def run():
    url = os.environ["SOURCES_DATABASE_URL"]
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    if context.is_offline_mode():
        context.configure(url=url, target_metadata=Base.metadata, literal_binds=True)
        with context.begin_transaction():
            context.run_migrations()
        return
    engine = create_engine(url, poolclass=pool.NullPool, hide_parameters=True)
    with engine.begin() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        context.run_migrations()
    engine.dispose()


run()
