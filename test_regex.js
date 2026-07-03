const line = 'AGENTS.md   Browser_optimization_fix.md   CLAUDE.md';
const regex = /(?:^|\s|\"|\')((?:\.\/|\/|~\|[a-zA-Z]:\\)?[^\s"']+\.md(?::\d+)?)(?=\s|\"|\'|$)/g;

let match;
while ((match = regex.exec(line)) !== null) {
  const startIndex = match.index + match[0].indexOf(match[1]);
  console.log(`Matched path: "${match[1]}"`);
  console.log(`start.x: ${startIndex + 1}, end.x: ${startIndex + match[1].length}`);
  console.log(`Substring: "${line.substring(startIndex, startIndex + match[1].length)}"`);
}
