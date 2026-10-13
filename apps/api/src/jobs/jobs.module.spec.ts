import { redisOptions } from './jobs.module';

describe('redisOptions', () => {
  it('should parse host, port, credentials, db and TLS from a URL', () => {
    expect(redisOptions('rediss://user:p%40ss@cache.internal:6380/2')).toEqual({
      host: 'cache.internal',
      port: 6380,
      username: 'user',
      password: 'p@ss',
      db: 2,
      tls: {},
      maxRetriesPerRequest: null,
    });
  });

  it('should default port and db when the URL omits them', () => {
    expect(redisOptions('redis://localhost')).toEqual({
      host: 'localhost',
      port: 6379,
      db: 0,
      maxRetriesPerRequest: null,
    });
  });
});
