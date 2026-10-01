"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWindowsCommandLine = parseWindowsCommandLine;
function parseWindowsCommandLine(command) {
    const args = [];
    const expression = /(?:[^\s"]|"(?:[^"\\]|\\.|\\)*")+/g;
    for (const match of command.matchAll(expression)) {
        let quoted = false;
        let value = '';
        const token = match[0];
        for (let i = 0; i < token.length; i++) {
            if (token[i] === '\\') {
                let count = 0;
                while (token[i + count] === '\\') {
                    count++;
                }
                if (token[i + count] === '"') {
                    value += '\\'.repeat(Math.floor(count / 2));
                    if (count % 2) {
                        value += '"';
                    }
                    else {
                        quoted = !quoted;
                    }
                    i += count;
                }
                else {
                    value += '\\'.repeat(count);
                    i += count - 1;
                }
            }
            else if (token[i] === '"') {
                quoted = !quoted;
            }
            else {
                value += token[i];
            }
        }
        if (quoted) {
            throw new SyntaxError('Unclosed quote in Windows command line');
        }
        args.push(value);
    }
    return args;
}
