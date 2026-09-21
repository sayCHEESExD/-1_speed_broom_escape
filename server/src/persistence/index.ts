import { serverConfig } from '../config/serverConfig.js';
import { logger } from '../util/logger.js';
import { JsonStorage } from './JsonStorage.js';
import { MongoStorage } from './MongoStorage.js';
import type { Storage } from './Storage.js';

export type { GrantRecord, Storage, StoredProfile } from './Storage.js';
export { StorageUnavailableError } from './Storage.js';

/**
 * The ONLY place a concrete store is named.
 *
 * `MONGODB_URI` set -> MongoDB. Bloxity Legion injects one into every backend
 * pod ("an ISOLATED managed Mongo db scoped to THIS game+channel"), so a deployed
 * server uses it with no configuration, and progress survives restarts, idle
 * scale-to-zero, deploys and any number of pods.
 *
 * Unset -> the JSON files in the data directory: local development, where
 * there is one process and no database to run.
 */
const createStorage = (): Storage => {
  if (serverConfig.mongodbUri) {
    logger.info('storage', 'MONGODB_URI is set: profiles and purchases live in MongoDB');
    return new MongoStorage(serverConfig.mongodbUri, serverConfig.dataDir);
  }
  logger.info('storage', `no MONGODB_URI: using the JSON dev store in ${serverConfig.dataDir}`);
  return new JsonStorage(serverConfig.dataDir);
};

/** Process-wide: every room shares one store, one queue and one connection. */
export const storage: Storage = createStorage();
