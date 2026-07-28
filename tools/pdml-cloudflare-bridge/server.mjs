import http from 'node:http';
import { URL } from 'node:url';

const port = Number(process.env.PDML_BRIDGE_PORT || 49190);
const upstream = process.env.PDML_FASTSERVER_URL || 'http://127.0.0.1:49090';
const bridgeKey = process.env.PDML_BRIDGE_KEY || '';
const internalToken = process.env.PDML_FASTSERVER_TOKEN || '111111';
const publicBaseUrl = (process.env.PDML_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

if (!bridgeKey) {
  console.error('PDML_BRIDGE_KEY is required');
  process.exit(1);
}

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
};

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > 1024 * 1024) {
      reject(new Error('body too large'));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const authorized = (req, url) => {
  const auth = req.headers.authorization || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  return req.headers['x-pdml-bridge-key'] === bridgeKey ||
    bearer === bridgeKey ||
    url.searchParams.get('key') === bridgeKey;
};

const stripSqlComments = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');

const allowedTables = new Set([
  'V_MLXX',
  'JMC_MLXX',
  'JMC_MLXX_TP',
  'JMC_MLXX_BJJL',
  'JMC_MLXX_CGBJ',
  'JMC_MLXX_B',
  'JMC_MLKC',
  'JMC_MLKC_HW',
  'JMC_YPRKMX',
  'JMC_YPCKMX',
  'JMC_CYXQ',
  'JMC_CYFP',
  'JMC_XYJLMX',
  'JMC_KDJLMX',
  'JMCCGDDMX',
  'JMCDD',
  'JMC_XSHTMX',
  'FZ_MLLX',
  'FZ_GYS',
]);

const validateSelectSql = (sql) => {
  const compact = stripSqlComments(String(sql || '')).replace(/\s+/g, ' ').trim();
  if (!compact) return 'SQL is empty';
  if (!/^select\s/i.test(compact)) return 'Only SELECT is allowed';
  if (compact.includes(';')) return 'Semicolon is not allowed';
  if (/\b(insert|update|delete|drop|alter|create|execute|exec|merge|grant|revoke|truncate)\b/i.test(compact)) {
    return 'Write or DDL keyword is not allowed';
  }
  const withoutStrings = compact.replace(/'([^']|'')*'/g, "''");
  const tableNames = [...withoutStrings.matchAll(/\b(?:from|join)\s+([A-Za-z_][A-Za-z0-9_$]*)/gi)]
    .map((match) => match[1].toUpperCase());
  if (!tableNames.length) return 'SELECT must read from an allowed table';
  const denied = tableNames.filter((tableName) => !allowedTables.has(tableName));
  if (denied.length) return `Table is not allowed: ${[...new Set(denied)].join(', ')}`;
  return '';
};

const responseBase = (req) => {
  if (publicBaseUrl) return publicBaseUrl;
  const proto = req.headers['cf-visitor']?.includes('https') || req.headers['x-forwarded-proto'] === 'https'
    ? 'https'
    : 'http';
  return `${proto}://${req.headers.host}`;
};

const rewriteImageUrls = (data, req) => {
  const base = responseBase(req);
  const rows = data?.ResultData?.SQL?.data;
  if (!Array.isArray(rows)) return data;
  for (const row of rows) {
    if (typeof row.TPDZ !== 'string') continue;
    const match = row.TPDZ.match(/\/firewebv\/MLXX\/[^?#\s]+/i);
    if (match) row.TPDZ = `${base}${match[0]}?key=${encodeURIComponent(bridgeKey)}`;
  }
  return data;
};

const proxyJson = async (req, res) => {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (error) {
    json(res, 400, { ResultCode: 'FAIL', msg: `Invalid JSON: ${error.message}` });
    return;
  }

  if (String(body.Doing || '').toLowerCase() !== 'select') {
    json(res, 403, { ResultCode: 'FAIL', msg: 'Only select is allowed' });
    return;
  }

  const validationError = validateSelectSql(body.SQL);
  if (validationError) {
    json(res, 403, { ResultCode: 'FAIL', msg: validationError });
    return;
  }

  const upstreamResponse = await fetch(`${upstream}/api/myapi/apidoing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({
      ...body,
      Doing: 'select',
      ZTCode: body.ZTCode || 'PDML',
      ModuleParams: body.ModuleParams || {},
      Token: internalToken,
    }),
  });

  const text = await upstreamResponse.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    res.writeHead(upstreamResponse.status, {
      'Content-Type': upstreamResponse.headers.get('content-type') || 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(text);
    return;
  }
  json(res, upstreamResponse.status, rewriteImageUrls(data, req));
};

const proxyImage = async (req, res, url) => {
  const upstreamUrl = `${upstream}${url.pathname}`;
  const upstreamResponse = await fetch(upstreamUrl, { method: req.method === 'HEAD' ? 'HEAD' : 'GET' });
  res.writeHead(upstreamResponse.status, {
    'Content-Type': upstreamResponse.headers.get('content-type') || 'application/octet-stream',
    'Cache-Control': upstreamResponse.ok ? 'public, max-age=86400' : 'no-store',
  });
  if (req.method === 'HEAD' || !upstreamResponse.body) {
    res.end();
    return;
  }
  for await (const chunk of upstreamResponse.body) res.write(chunk);
  res.end();
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true, upstream });
      return;
    }
    if (!authorized(req, url)) {
      json(res, 401, { ResultCode: 'FAIL', msg: 'Unauthorized' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/myapi/apidoing') {
      await proxyJson(req, res);
      return;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && /^\/firewebv\/MLXX\//i.test(url.pathname)) {
      await proxyImage(req, res, url);
      return;
    }
    json(res, 404, { ResultCode: 'FAIL', msg: 'Not found' });
  } catch (error) {
    json(res, 500, { ResultCode: 'FAIL', msg: error.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`PDML bridge listening on http://127.0.0.1:${port}`);
  console.log(`Upstream FastServer: ${upstream}`);
});
