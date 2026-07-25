import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, watch } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { ImportRepository } from "../../app/ports/import-repository";
import { importStandardFile, parseStandardImportFile } from "../../app/use-cases/import-standard-file";

type WatchedImportsOptions = {
  repository: ImportRepository;
  rootPath?: string;
  logger?: Pick<Console, "error" | "info">;
  afterProcessedImport?: () => Promise<void>;
};

type ImportPaths = {
  incoming: string;
  processing: string;
  processed: string;
  failed: string;
};

export async function startWatchedImports({
  repository,
  rootPath = resolve(process.cwd(), "imports"),
  logger = console,
  afterProcessedImport,
}: WatchedImportsOptions) {
  const paths: ImportPaths = {
    incoming: join(rootPath, "incoming"),
    processing: join(rootPath, "processing"),
    processed: join(rootPath, "processed"),
    failed: join(rootPath, "failed"),
  };

  await Promise.all(Object.values(paths).map(path => mkdir(path, { recursive: true })));

  const processIncoming = async () => {
    const entries = await readdir(paths.incoming, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && extname(entry.name).toLowerCase() === ".json") {
        await claimAndProcess(join(paths.incoming, entry.name), paths, repository, logger, afterProcessedImport);
      }
    }
  };

  await recoverProcessingFiles(paths, repository, logger);
  await processIncoming();

  const watcher = watch(paths.incoming);
  let scanning = false;
  let scanAgain = false;
  const run = async () => {
    if (scanning) {
      scanAgain = true;
      return;
    }
    scanning = true;
    try {
      do {
        scanAgain = false;
        await processIncoming();
      } while (scanAgain);
    } catch (error) {
      logger.error("Unable to scan incoming imports", error);
    } finally {
      scanning = false;
    }
  };

  (async () => {
    for await (const event of watcher) {
      if (!event.filename || extname(event.filename).toLowerCase() === ".json") void run();
    }
  })().catch(error => logger.error("Import watcher stopped", error));

  return {
    close: async () => {
      await watcher.return?.();
    },
    scan: processIncoming,
  };
}

async function recoverProcessingFiles(
  paths: ImportPaths,
  repository: ImportRepository,
  logger: Pick<Console, "error" | "info">,
) {
  const entries = await readdir(paths.processing, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".json") continue;

    const path = join(paths.processing, entry.name);
    try {
      const fileHash = await hashFile(path);
      const batch = await repository.findBatchByFileHash(fileHash);
      if (batch?.status === "processed") {
        await moveToDestination(path, paths.processed, fileHash);
      } else if (batch?.status === "failed") {
        await moveToDestination(path, paths.failed, fileHash);
      } else {
        await processClaimedFile(path, paths, repository, logger, undefined);
      }
    } catch (error) {
      logger.error(`Unable to recover import ${entry.name}`, error);
    }
  }
}

async function claimAndProcess(
  incomingPath: string,
  paths: ImportPaths,
  repository: ImportRepository,
  logger: Pick<Console, "error" | "info">,
  afterProcessedImport?: () => Promise<void>,
) {
  const name = basename(incomingPath);
  const claimedPath = join(paths.processing, name);
  try {
    await rename(incomingPath, claimedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") logger.error(`Unable to claim import ${name}`, error);
    return;
  }
  await processClaimedFile(claimedPath, paths, repository, logger, afterProcessedImport);
}

async function processClaimedFile(
  claimedPath: string,
  paths: ImportPaths,
  repository: ImportRepository,
  logger: Pick<Console, "error" | "info">,
  afterProcessedImport?: () => Promise<void>,
) {
  const fileName = basename(claimedPath);
  const fileHash = await hashFile(claimedPath);

  try {
    const json = JSON.parse(await readFile(claimedPath, "utf8"));
    const importFile = parseStandardImportFile(json);
    const result = await importStandardFile(repository, { fileName, fileHash, importFile });

    if (result.kind === "failed") {
      await moveToDestination(claimedPath, paths.failed, fileHash);
      logger.error(`Import failed for ${fileName}: ${result.errorMessage}`);
      return;
    }

    if (result.kind === "processed" && (importFile.source.slug === "hsbc" || importFile.source.slug === "paypal") && afterProcessedImport) {
      try {
        await afterProcessedImport();
      } catch (error) {
        logger.error(`Imported ${fileName}, but unable to propose PayPal matches`, error);
      }
    }

    await moveToDestination(claimedPath, paths.processed, fileHash);
    logger.info(result.kind === "duplicate" ? `Skipped duplicate import ${fileName}` : `Imported ${fileName}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown import failure";
    await repository.recordFailure({ fileName, fileHash, errorMessage });
    await moveToDestination(claimedPath, paths.failed, fileHash);
    logger.error(`Import failed for ${fileName}: ${errorMessage}`);
  }
}

async function hashFile(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function moveToDestination(path: string, destinationDirectory: string, fileHash: string) {
  const originalName = basename(path);
  const destination = join(destinationDirectory, originalName);
  try {
    await rename(path, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const extension = extname(originalName);
    const name = originalName.slice(0, -extension.length);
    await rename(path, join(destinationDirectory, `${name}-${fileHash.slice(0, 8)}${extension}`));
  }
}
