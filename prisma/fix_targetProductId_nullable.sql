-- Migration: Make targetProductId nullable in ProductCompatibility (SQLite)
-- This script will recreate the ProductCompatibility table with targetProductId as nullable

PRAGMA foreign_keys=off;

-- 1. Rename the existing table
ALTER TABLE ProductCompatibility RENAME TO ProductCompatibility_old;

-- 2. Recreate the table with the correct schema (targetProductId nullable)
CREATE TABLE ProductCompatibility (
  id TEXT PRIMARY KEY,
  sourceProductId TEXT NOT NULL,
  targetType TEXT NOT NULL DEFAULT 'INTERNAL',
  targetProductId TEXT,
  externalReferenceId TEXT,
  relationType TEXT NOT NULL,
  note TEXT,
  isActive BOOLEAN NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdBy TEXT NOT NULL DEFAULT 'local',
  deactivatedAt DATETIME,
  deactivatedBy TEXT,
  operationId TEXT,
  -- Indexes and constraints will be recreated below
  FOREIGN KEY (externalReferenceId) REFERENCES ExternalProductReference(id),
  FOREIGN KEY (operationId) REFERENCES OperationLog(id)
);

-- 3. Copy data back
INSERT INTO ProductCompatibility (
  id, sourceProductId, targetType, targetProductId, externalReferenceId, relationType, note, isActive, createdAt, createdBy, deactivatedAt, deactivatedBy, operationId
) SELECT 
  id, sourceProductId, targetType, targetProductId, externalReferenceId, relationType, note, isActive, createdAt, createdBy, deactivatedAt, deactivatedBy, operationId
FROM ProductCompatibility_old;

-- 4. Recreate indexes and unique constraints
CREATE INDEX IF NOT EXISTS idx_pc_sourceProductId ON ProductCompatibility(sourceProductId);
CREATE INDEX IF NOT EXISTS idx_pc_targetProductId ON ProductCompatibility(targetProductId);
CREATE INDEX IF NOT EXISTS idx_pc_externalReferenceId ON ProductCompatibility(externalReferenceId);
CREATE INDEX IF NOT EXISTS idx_pc_relationType ON ProductCompatibility(relationType);
CREATE INDEX IF NOT EXISTS idx_pc_isActive ON ProductCompatibility(isActive);
CREATE INDEX IF NOT EXISTS idx_pc_operationId ON ProductCompatibility(operationId);
CREATE INDEX IF NOT EXISTS idx_pc_sourceProductId_isActive ON ProductCompatibility(sourceProductId, isActive);
CREATE INDEX IF NOT EXISTS idx_pc_targetProductId_isActive ON ProductCompatibility(targetProductId, isActive);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pc_internal ON ProductCompatibility(sourceProductId, targetProductId, relationType);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pc_external ON ProductCompatibility(sourceProductId, externalReferenceId, relationType);

-- 5. Drop the old table
DROP TABLE ProductCompatibility_old;

PRAGMA foreign_keys=on;
