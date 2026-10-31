import test from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'net';
import { findPortConflicts, parsePublishedPorts, portConflictMessage, portInUseFromDockerError, templateConnection, tryBind } from './ports';

const config = JSON.stringify({
  services: {
    postgres: { ports: [{ mode: 'ingress', host_ip: '127.0.0.1', target: 5432, published: '5432', protocol: 'tcp' }] },
    kafka: { ports: [{ target: 9092, published: '9092', protocol: 'tcp' }] },
    random: { ports: [{ target: 80, protocol: 'tcp' }] }, // unpublished: Docker picks a port
    dns: { ports: [{ target: 53, published: '5353', protocol: 'udp' }] },
  },
});

test('reads the published TCP host ports from compose config', () => {
  assert.deepEqual(parsePublishedPorts(config), [
    { service: 'postgres', port: 5432, hostIp: '127.0.0.1' },
    { service: 'kafka', port: 9092, hostIp: '0.0.0.0' },
  ]);
  assert.deepEqual(parsePublishedPorts('not json'), []);
});

test('finds a port another program holds, with a real bind', async () => {
  const holder = net.createServer();
  await new Promise<void>(r => holder.listen(0, '127.0.0.1', () => r()));
  const held = (holder.address() as net.AddressInfo).port;
  try {
    assert.equal(await tryBind(held, '127.0.0.1'), 'in-use');
    const taken = await findPortConflicts([
      { service: 'postgres', port: held, hostIp: '127.0.0.1' },
      { service: 'free', port: 0, hostIp: '127.0.0.1' },
    ]);
    assert.deepEqual(taken.map(t => t.service), ['postgres']);
  } finally {
    holder.close();
  }
});

test('only "address in use" blocks a lab', async () => {
  const taken = await findPortConflicts([{ service: 'x', port: 1, hostIp: '127.0.0.1' }], async () => 'unknown');
  assert.deepEqual(taken, []);
});

test('tells the trainee which port, which service and how to find the program', () => {
  const one = portConflictMessage([{ service: 'postgres', port: 5432, hostIp: '0.0.0.0' }]);
  assert.match(one, /^Port 5432 \(postgres\) is already in use on this machine/);
  assert.match(one, /another port in the form/);
  assert.match(one, process.platform === 'win32' ? /netstat -ano \| findstr :5432/ : /lsof -nP -iTCP:5432/);
  assert.match(portConflictMessage([{ service: 'a', port: 1, hostIp: '' }, { service: 'b', port: 2, hostIp: '' }]), /^Ports 1 \(a\), 2 \(b\) are already in use/);
});

test('recognises Docker\'s port-clash errors', () => {
  assert.equal(portInUseFromDockerError('Error response from daemon: ... Bind for 0.0.0.0:5432 failed: port is already allocated'), 5432);
  assert.equal(portInUseFromDockerError('listen tcp4 0.0.0.0:9092: bind: address already in use'), 9092);
  assert.equal(portInUseFromDockerError('no such image'), undefined);
});

test('a template\'s connection string gets the published port; unsafe ones are ignored', () => {
  const ports = { postgres: 5444, grafana: 3001 };
  assert.equal(templateConnection({ service: 'postgres', url: 'postgresql://dev:dev@localhost:{port}/app' }, ports), 'postgresql://dev:dev@localhost:5444/app');
  assert.equal(templateConnection({ service: 'grafana', url: 'http://localhost:{port}' }, ports), 'http://localhost:3001');
  assert.equal(templateConnection({ service: 'nope', url: 'http://localhost:{port}' }, ports), undefined);
  assert.equal(templateConnection({ service: 'postgres', url: 'postgresql://dev:dev@evil.example:{port}/app' }, ports), undefined);
  assert.equal(templateConnection({ service: 'postgres', url: 'javascript:alert({port})' }, ports), undefined);
  assert.equal(templateConnection({ service: 'postgres', url: 'postgresql://localhost:5432' }, ports), undefined); // no {port}
  assert.equal(templateConnection({ service: 'constructor', url: 'http://localhost:{port}' }, ports), undefined);
  assert.equal(templateConnection(undefined, ports), undefined);
});
