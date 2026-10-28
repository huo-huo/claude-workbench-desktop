import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workspaceTree } from '../server/workspace/files.mjs';

/** 构造最小项目目录：两个隐藏文件夹、一个隐藏文件、两个重型目录 */
function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-tree-'));
  fs.mkdirSync(path.join(root, '.github'));
  fs.mkdirSync(path.join(root, '.vscode'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# demo\n');
  fs.writeFileSync(path.join(root, '~$draft.docx'), 'tmp');
  return root;
}

test('文件树展示隐藏文件与隐藏文件夹', () => {
  const root = createFixture();
  const names = workspaceTree(root).children.map(item => item.name);
  assert.ok(names.includes('.github'));
  assert.ok(names.includes('.vscode'));
  assert.ok(names.includes('.gitignore'));
});

test('文件树仍跳过重型目录与 Office 临时文件', () => {
  const root = createFixture();
  const names = workspaceTree(root).children.map(item => item.name);
  assert.ok(!names.includes('.git'));
  assert.ok(!names.includes('node_modules'));
  assert.ok(!names.includes('~$draft.docx'));
});

test('文件夹排在文件之前', () => {
  const root = createFixture();
  const types = workspaceTree(root).children.map(item => item.type);
  const lastFolder = types.lastIndexOf('folder');
  const firstFile = types.indexOf('file');
  assert.ok(lastFolder < firstFile);
});
