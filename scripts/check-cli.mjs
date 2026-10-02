import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const output = readFileSync(process.argv[2], 'utf8');
assert.match(output, /Author title wins/u);
assert.match(output, /End of the streamed document/u);
assert.match(output, /https:\/\/example.test\/failure/u);
assert.equal(
  output.includes('\u001b['),
  false,
  'Piped stdout must not contain cursor or style control sequences',
);
assert.equal(
  output.split('End of the streamed document').length - 1,
  1,
  'Pipe must receive one completed document',
);
