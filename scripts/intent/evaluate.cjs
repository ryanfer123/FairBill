const { readFileSync } = require('node:fs');
const { classifyRequest } = require(process.argv[2]);
const rows = readFileSync(require('node:path').join(__dirname, 'held-out.tsv'), 'utf8').trim().split('\n');
let correct = 0;
for (const row of rows) {
  const [expected, text] = row.split('\t');
  const result = classifyRequest(text);
  if (expected === result.intent) correct += 1;
  else console.log({ text, expected, ...result });
}
console.log(`${correct}/${rows.length} correct`);
