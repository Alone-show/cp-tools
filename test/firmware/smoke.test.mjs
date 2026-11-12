import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { apply, name, inject } from '../../src/firmware/index.js';
import { makeIndex } from './index-fixture.mjs';

const ALLOWED_KEYWORDS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title',
]);

function walkSchema(node, pathLabel, violations) {
  if (!node || typeof node !== 'object') {
    violations.push(`${pathLabel} 不是 schema 对象`);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (!ALLOWED_KEYWORDS.has(key)) violations.push(`${pathLabel}.${key} 不是支持的 keyword`);
    if (key === 'properties') {
      for (const [prop, child] of Object.entries(value)) walkSchema(child, `${pathLabel}.properties.${prop}`, violations);
    } else if (key === 'items') {
      walkSchema(value, `${pathLabel}.items`, violations);
    } else if (key === 'oneOf') {
      value.forEach((child, i) => walkSchema(child, `${pathLabel}.oneOf[${i}]`, violations));
    }
  }
}

function registry() {
  const tools = [];
  const ctx = {
    get: () => undefined,
    on: () => () => {},
    skills: { register: () => () => {} },
    effect: (fn) => {
      fn();
      return () => {};
    },
    tools: {
      register(definition) {
        tools.push(definition);
        return () => {};
      },
    },
  };
  apply(ctx);
  return tools;
}

function textOf(tool, value) {
  const blocks = tool.output.render({}, value);
  assert.ok(Array.isArray(blocks) && blocks.length > 0, 'render 必须返回内容块');
  assert.equal(blocks[0].type, 'text');
  assert.equal(typeof blocks[0].text, 'string');
  return blocks[0].text;
}

/** 写 v2 索引：index.json 不带 commits，提交正文进 commits.json */
function writeIndex(dataDir, index) {
  fs.mkdirSync(path.join(dataDir, 'raw'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'parsed'), { recursive: true });
  const { commits, ...manifest } = index;
  const table = {};
  for (const [hash, commit] of Object.entries(commits)) {
    const { lines, ...meta } = commit;
    table[hash] = meta;
  }
  fs.writeFileSync(path.join(dataDir, 'index.json'), JSON.stringify(manifest), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'commits.json'), JSON.stringify(table), 'utf8');
}

function withIndex(prefix, fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.DSH_FIXFINDER_DIR = dataDir;
  writeIndex(dataDir, makeIndex());
  return { dataDir, run: async () => fn(dataDir) };
}

const tool = (tools, toolName) => tools.find((t) => t.name === toolName);

test('firmware 插件元信息与 2 个工具注册', () => {
  assert.equal(name, 'firmware-finder');
  assert.deepEqual(inject, ['tools', 'skills']);
  const tools = registry();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['firmware_find', 'firmware_models']);
  for (const definition of tools) {
    assert.equal(typeof definition.description, 'string');
    assert.ok(definition.description.length > 20);
    assert.equal(definition.parameters.type, 'object');
    assert.ok(definition.output?.schema, `${definition.name} 缺 output.schema`);
    assert.equal(typeof definition.output.render, 'function', `${definition.name} 缺 output.render`);
    const violations = [];
    walkSchema(definition.output.schema, `${definition.name}.output.schema`, violations);
    walkSchema(definition.parameters, `${definition.name}.parameters`, violations);
    assert.deepEqual(violations, [], `${definition.name} schema 用了不支持的 keyword：${violations.join('; ')}`);
  }
});

