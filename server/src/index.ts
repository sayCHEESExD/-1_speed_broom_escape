import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@broom/shared';
import { serverConfig } from './config/serverConfig.js';
import { createHttpServer } from './httpServer.js';
import { storage } from './persistence/index.js';
import { profileStore } from './progression/ProfileStore.js';
import { CourseRoom } from './rooms/CourseRoom.js';
import { logger } from './util/logger.js';

const SCOPE = 'server';

/** Longest shutdown waits for queued saves to land. Legion allows up to 10 minutes. */
const SHUTDOWN_FLUSH_MS = 30_000;

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createHttpServer() }),
  greet: false,
  /*
   * OFF, and this matters. Colyseus installs its own SIGTERM/SIGINT handler by
   * default, which calls `gracefullyShutdown(true)` - and that calls
   * `process.exit` in its own `finally`, racing the handler below. The process
   * would be gone before the store had flushed the saves the room disposal
   * just queued. This file owns shutdown instead.
   */
  gracefullyShutdown: false,
});

gameServer.define(ROOM_NAME, CourseRoom);

/*
 * Storage opens WITHOUT blocking the listener. If the database is down at
 * boot, the server still comes up and `/health` keeps answering - otherwise
 * Legion would restart-loop the pod - and joins are refused cleanly until the
 * database is back. `open` logs loudly and never throws.
 */
void storage.open().then(() => profileStore.start());

gameServer
  .listen(serverConfig.port, serverConfig.host)
  .then(() => {
    logger.info(
      SCOPE,
      `listening on ${serverConfig.host}:${serverConfig.port} room="${ROOM_NAME}" ` +
        `health=/health storage=${storage.kind}`,
    );
  })
  .catch((error: unknown) => {
    logger.error(SCOPE, 'failed to start', error);
    process.exit(1);
  });

let shuttingDown = false;

/**
 * Drain, then flush, then exit - in that order.
 *
 * `gracefullyShutdown(false)` disposes every room (which QUEUES each remaining
 * player's save) and returns WITHOUT exiting. Only then is the store flushed
 * and closed. With no argument it would exit in its own `finally` and the
 * flush would never run.
 */
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(SCOPE, `received ${signal}, shutting down`);
  try {
    await gameServer.gracefullyShutdown(false);
  } catch (error) {
    logger.error(SCOPE, 'room shutdown failed; flushing saves anyway', error);
  }
  profileStore.stop();
  await storage.flush(SHUTDOWN_FLUSH_MS);
  await storage.close();
  logger.info(SCOPE, 'saves flushed; exiting');
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
