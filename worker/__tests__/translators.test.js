// const translators = require('../translators');
// TODO: Fix module path or mock Firebase/Google Cloud dependencies

describe.skip('Translators Module', () => {
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