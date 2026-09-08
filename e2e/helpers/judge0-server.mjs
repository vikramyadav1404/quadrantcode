/**
 * Local Judge0 HTTP contract server for browser tests.
 *
 * The application still selects the real Judge0Provider in production mode;
 * this process only supplies that provider with deterministic test responses.
 * Nothing in application code can select the old fake execution provider in a
 * production build.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.JUDGE0_E2E_PORT ?? 3211);
const submissions = new Map();

function respond(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    respond(response, 200, { status: 'ok' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/languages') {
    respond(response, 200, [
      { id: 110, name: 'C (GCC 12.2.0)' },
      { id: 111, name: 'C++ (GCC 12.2.0)' },
      { id: 112, name: 'Java (OpenJDK 21.0.2)' },
      { id: 113, name: 'Python (3.12.1)' },
      { id: 114, name: 'JavaScript (Node.js 22.1.0)' },
    ]);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/submissions') {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on('end', () => {
      try {
        const submission = JSON.parse(body);
        const token = randomUUID();
        submissions.set(token, submission);
        respond(response, 201, { token });
      } catch {
        respond(response, 400, { error: 'invalid request' });
      }
    });
    return;
  }

  const match = /^\/submissions\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'GET' && match) {
    const submission = submissions.get(match[1]);
    if (!submission) {
      respond(response, 404, { error: 'unknown submission' });
      return;
    }

    respond(response, 200, {
      status: { id: 3 },
      time: '0.01',
      memory: 2048,
      stdout: submission.stdin || null,
      stderr: null,
      compile_output: null,
    });
    return;
  }

  respond(response, 404, { error: 'not found' });
});

server.listen(port, '127.0.0.1');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
