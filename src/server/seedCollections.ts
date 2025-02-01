import { useLogger } from '@anupheaus/socket-api/server';
import { configRegistry } from '../common/registries';
import { useCollection, useCollections } from './collections';

export async function seedCollections() {
  const logger = useLogger();
  const collections = useCollections();
  logger.info('Seeding collections...');
  for (const collection of collections) {
    const config = configRegistry.get(collection);
    if (config == null) {
      logger.warn(`No config found for collection "${collection.name}", skipping seeding.`);
      return;
    }
    if (config.onSeed == null) continue;
    logger.info(`Seeding "${collection.name}" collection...`);
    const startTime = Date.now();
    try {
      await config.onSeed(useCollection);
      logger.info(`Collection "${collection.name}" seeded (time taken: ${Date.now() - startTime}ms).`);
    } catch (error) {
      logger.error(`Error seeding collection "${collection.name}":`, { error });
    }
  }
  logger.info('Collections seeded.');
}