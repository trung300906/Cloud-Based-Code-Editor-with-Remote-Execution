const DockerRunner = require('./DockerRunner');

async function test() {
  const runner = new DockerRunner({
    timeout: 5000,
    memoryLimit: '50m'
  });

  const codeJS = `
    console.log('Hello from Node.js inside Docker!');
    console.error('This is stderr');
    setTimeout(() => {
      console.log('Delayed output');
    }, 1000);
  `;

  console.log('--- Running JavaScript ---');
  const streamJS = await runner.run(codeJS, 'javascript');
  
  streamJS.on('data', (line) => {
    console.log('JS OUT:', line);
  });
  
  streamJS.on('end', () => {
    console.log('--- JavaScript finished ---\n');
    testPython();
  });

  streamJS.on('error', (err) => {
    console.error('Stream error:', err);
  });
}

async function testPython() {
  const runner = new DockerRunner({
    image: 'python:3.12-alpine',   // Cần image có Python
    timeout: 5000
  });

  const codePython = `
import sys
print("Hello from Python!")
print("Error message", file=sys.stderr)
  `;

  console.log('--- Running Python ---');
  const stream = await runner.run(codePython, 'python');
  
  stream.on('data', (line) => {
    console.log('PY OUT:', line);
  });
  
  stream.on('end', () => {
    console.log('--- Python finished ---');
  });
}

test().catch(console.error);