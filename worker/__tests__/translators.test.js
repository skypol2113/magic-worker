const translators = require('../worker/translators');

describe('Translators Module', () => {
  test('detectLanguage should work with basic text', async () => {
    const lang = await translators.detectLanguage('Hello world');
    expect(typeof lang).toBe('string');
  }, 10000);

  test('translateToEn should return object with text', async () => {
    const result = await translators.translateToEn('Привет');
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('provider');
  }, 15000);
});