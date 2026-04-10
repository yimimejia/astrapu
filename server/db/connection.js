import sqlite3 from 'sqlite3';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.ASTRAPU_DB_PATH || path.join(__dirname, '..', '..', 'astrapu.sqlite');

export const db = new sqlite3.Database(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

export function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

export function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

export function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

export function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

export async function withTransaction(work) {
  await exec('BEGIN IMMEDIATE');
  try {
    const result = await work();
    await exec('COMMIT');
    return result;
  } catch (error) {
    await exec('ROLLBACK');
    throw error;
  }
}

function hashPassword(password) {
  const salt = process.env.PASSWORD_SALT || 'astrapu-dev-salt';
  return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

export async function migrate() {
  const sql = await readFile(path.join(__dirname, 'migrations', '001_init.sql'), 'utf8');
  await exec(sql);

  await run(
    `INSERT OR IGNORE INTO usuarios(id, username, nombre, password_hash, rol, sucursal_id)
     VALUES('u-admin','admin','Administrador General', ?, 'admin','suc-1')`,
    [hashPassword('admin123')],
  );
  await run(
    `INSERT OR IGNORE INTO usuarios(id, username, nombre, password_hash, rol, sucursal_id)
     VALUES('u-envios','m.perez','María Pérez', ?, 'envios','suc-1')`,
    [hashPassword('envios123')],
  );
  await run(
    `INSERT OR IGNORE INTO usuarios(id, username, nombre, password_hash, rol, sucursal_id)
     VALUES('u-entrega','j.rodriguez','Juan Rodríguez', ?, 'entrega','suc-2')`,
    [hashPassword('entrega123')],
  );
  await run(
    `INSERT OR IGNORE INTO usuarios(id, username, nombre, password_hash, rol, sucursal_id)
     VALUES('u-contable','contable','Laura Contable', ?, 'contable','suc-1')`,
    [hashPassword('contable123')],
  );
}

export function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}
