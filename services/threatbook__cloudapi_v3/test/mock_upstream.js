/* node:coverage disable */
import http from 'node:http';

const parseQuery = (url) => {
  const out = {};
  const idx = String(url || '').indexOf('?');
  if (idx < 0) return out;
  const qs = String(url).slice(idx + 1);
  for (const part of qs.split('&')) {
    if (!part) continue;
    const [key, value] = part.split('=', 2);
    const decodedKey = decodeURIComponent(key || '').trim();
    if (!decodedKey) continue;
    out[decodedKey] = decodeURIComponent(value || '');
  }
  return out;
};

export const createMockServer = async ({ expectedApiKey = 'test_api_key' } = {}) => {
  const requests = [];

  const sendJson = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    const url = req.url || '';
    const path = url.split('?', 1)[0] || '';
    const query = parseQuery(url);
    requests.push({ method: req.method, path, query });

    if (req.method !== 'GET') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    if (
      path !== '/v3/scene/ip_reputation'
      && path !== '/1.1.1/domain/query'
      && path !== '/v3/scene/dns'
    ) {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    const apikey = String(query.apikey || '').trim();
    const resource = String(query.resource || '').trim();

    if (!apikey) {
      sendJson(res, 401, { response_code: 1100, verbose_msg: 'apikey required' });
      return;
    }
    if (apikey !== expectedApiKey) {
      sendJson(res, 401, { response_code: 1101, verbose_msg: 'invalid apikey' });
      return;
    }
    if (!resource) {
      sendJson(res, 200, { response_code: 1200, verbose_msg: 'resource required' });
      return;
    }
    if (resource.includes('http401')) {
      sendJson(res, 401, { response_code: 1301, verbose_msg: 'unauthorized' });
      return;
    }
    if (resource.includes('http500')) {
      sendJson(res, 500, { message: 'internal error' });
      return;
    }
    if (resource.includes('bizfail')) {
      sendJson(res, 200, { response_code: 1400, verbose_msg: 'business failed', data: { resource } });
      return;
    }
    if (resource.includes('invalid-json')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not-json');
      return;
    }

    sendJson(res, 200, {
      response_code: 0,
      verbose_msg: 'OK',
      data: {
        kind: path.includes('ip_reputation')
          ? 'ip_reputation'
          : (path.includes('scene/dns') ? 'scene_dns' : 'domain_query'),
        resource,
        lang: query.lang || 'zh',
        exclude: query.exclude || '',
      },
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
