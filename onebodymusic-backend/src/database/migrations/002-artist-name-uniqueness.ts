import { Sequelize } from 'sequelize-typescript';

export async function up(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    // Do not merge or delete pre-existing duplicates; fail safely for explicit resolution.
    await database.query(`CREATE UNIQUE INDEX "Artist_normalized_name_key"
      ON "Artist" (lower(btrim(regexp_replace("name", '[[:space:]]+', ' ', 'g'))));`, { transaction });
  });
}

export async function down(database: Sequelize): Promise<void> {
  await database.query('DROP INDEX "Artist_normalized_name_key"');
}
