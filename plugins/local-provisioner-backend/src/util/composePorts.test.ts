import { publishedHostPorts } from './composePorts';

const compose = (ports: string) => `services:\n  app:\n    image: busybox\n    ports:\n${ports}\n`;

describe('publishedHostPorts', () => {
  it('reads the host side of the short syntax, with or without a host address', () => {
    expect(publishedHostPorts(compose('      - "127.0.0.1:4566:4566"\n      - "8080:80"\n      - 9090:9090/tcp'))).toEqual([
      4566, 8080, 9090,
    ]);
  });

  it('reads an IPv6 host address', () => {
    expect(publishedHostPorts(compose('      - "[::1]:9000:9000"'))).toEqual([9000]);
  });

  it('expands a range', () => {
    expect(publishedHostPorts(compose('      - "5000-5002:5000-5002"'))).toEqual([5000, 5001, 5002]);
  });

  it('reads the long syntax and ignores UDP', () => {
    const text = [
      'services:',
      '  app:',
      '    image: busybox',
      '    ports:',
      '      - target: 80',
      '        published: 8081',
      '        host_ip: 127.0.0.1',
      '      - target: 53',
      '        published: 5353',
      '        protocol: udp',
      '      - target: 81',
      '        published: "8082"',
    ].join('\n');
    expect(publishedHostPorts(text)).toEqual([8081, 8082]);
  });

  it('skips ports with no fixed host side: container-only, UDP, or not filled in', () => {
    const text = compose(
      ['      - "80"', '      - 3000', '      - "5353:53/udp"', '      - "${PORT}:80"', '      - "127.0.0.1:${PORT}:80"'].join('\n'),
    );
    expect(publishedHostPorts(text)).toEqual([]);
  });

  it('uses the default of a ${VAR:-port} host side, and skips a bare ${VAR}', () => {
    expect(publishedHostPorts(compose('      - "${POSTGRES_PORT:-5432}:5432"\n      - "${REDIS_PORT-6379}:6379"'))).toEqual([5432, 6379]);
    expect(publishedHostPorts(compose('      - "${PORT}:80"\n      - "${PORT:?set it}:80"'))).toEqual([]);
  });

  it('skips services a plain `up -d` does not publish: profile-only ones and host-network ones', () => {
    const text = [
      'services:',
      '  debug:',
      '    profiles: [debug]',
      '    ports: ["127.0.0.1:9229:9229"]',
      '  host:',
      '    network_mode: host',
      '    ports: ["8080:8080"]',
      '  web:',
      '    ports: ["127.0.0.1:3000:3000"]',
    ].join('\n');
    expect(publishedHostPorts(text)).toEqual([3000]);
  });

  it('collects every service once, sorted', () => {
    const text = [
      'services:',
      '  a:',
      '    ports: ["127.0.0.1:9000:80", "127.0.0.1:4566:4566"]',
      '  b:',
      '    ports: ["127.0.0.1:4566:4566", "127.0.0.1:8090:8080"]',
      '  c:',
      '    image: busybox',
    ].join('\n');
    expect(publishedHostPorts(text)).toEqual([4566, 8090, 9000]);
  });

  it('refuses nonsense instead of throwing', () => {
    for (const bad of [undefined, null, 42, '', '   ', ': : :', '[', 'services: 3', 'services:\n  a: 1', compose('      - "0:80"'), compose('      - "70000:80"'), compose('      - "1-99999:1-99999"')]) {
      expect(publishedHostPorts(bad)).toEqual([]);
    }
  });
});
